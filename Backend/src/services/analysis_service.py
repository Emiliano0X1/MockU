"""
Post-interview analysis: sends the session's recording and context to the
ai-service (ai-service/app/main.py, POST /analyze/interview) and stores what
comes back as transcript_segments, a report and report_findings.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List
from uuid import uuid4

import httpx

from src.core.config import supabase
from src.core.live_config import AI_SERVICE_TIMEOUT_S, AI_SERVICE_URL, detector_config
from src.services.company_service import get_company_by_id
from src.services.resume_service import get_resume_text
from src.services.session_service import get_session_by_id

logger = logging.getLogger("mocku.analysis")

AUDIO_BUCKET = "audio"
SIGNED_URL_SECONDS = 60 * 60


def _signed_audio_url(session_id: str) -> str:
    rows = supabase.table("audio_recordings").select("storage_path").eq("session_id", session_id).limit(1).execute().data
    if not rows:
        raise RuntimeError("No audio recording for this session.")
    signed = supabase.storage.from_(AUDIO_BUCKET).create_signed_url(rows[0]["storage_path"], SIGNED_URL_SECONDS)
    url = signed.get("signedURL") or signed.get("signedUrl") if isinstance(signed, dict) else None
    if not url:
        raise RuntimeError(f"Could not create a signed URL for {rows[0]['storage_path']}.")
    return url


def _job_description(company_id: str, role_title: str) -> str:
    try:
        company = get_company_by_id(company_id)
    except Exception:
        return role_title
    values = "; ".join(f"{v.get('name')}: {v.get('description')}" for v in (company.get("values") or []) if isinstance(v, dict))
    parts = [
        f"{role_title} at {company.get('name')}",
        f"Industry: {company.get('industry')}" if company.get("industry") else "",
        f"Culture: {company.get('culture_summary')}" if company.get("culture_summary") else "",
        f"Values: {values}" if values else "",
    ]
    return ". ".join(p for p in parts if p)


def _heart_rate_events(session_id: str) -> List[Dict[str, Any]]:
    rows = (
        supabase.table("live_suggestions")
        .select("t_ms, text, severity, bpm_at_trigger, baseline_bpm, trigger_reason")
        .eq("session_id", session_id)
        .neq("trigger_reason", "manual_test")
        .order("t_ms")
        .execute()
        .data
    )
    return rows or []


def _biometric_findings(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Each live heart-rate tip becomes a finding covering the spike that triggered it."""
    findings = []
    for e in events:
        bpm, baseline = e.get("bpm_at_trigger"), e.get("baseline_bpm")
        findings.append({
            "category": "biometric",
            "start_ms": max(0, e["t_ms"] - detector_config.SUSTAIN_MS),
            "end_ms": e["t_ms"],
            "severity": e.get("severity") or "medium",
            "title": f"Heart rate spiked to {bpm} bpm" if bpm else "Heart rate spiked",
            "details": {
                "note": f"Your pulse stayed {bpm - baseline} bpm above your resting {baseline} for several seconds, "
                        f'and Mocky suggested: "{e.get("text")}".'
                if bpm and baseline else f'Mocky suggested: "{e.get("text")}".',
                "bpm": bpm,
                "baseline_bpm": baseline,
            },
        })
    return findings


def _save_results(session_id: str, analysis: Dict[str, Any], extra_findings: List[Dict[str, Any]]) -> None:
    now = datetime.now(timezone.utc).isoformat()

    # Transcript (replace any previous run).
    logger.info("[%s] save 1/3: %d transcript segments", session_id, len(analysis["segments"]))
    supabase.table("transcript_segments").delete().eq("session_id", session_id).execute()
    segments = [{"id": str(uuid4()), "session_id": session_id, **s} for s in analysis["segments"]]
    if segments:
        supabase.table("transcript_segments").insert(segments).execute()

    # Report. The summary column is `summary_json` (NOT NULL) in the current
    # Supabase schema; older schemas called it `summary`.
    summary = analysis["summary"]
    report_id = str(uuid4())
    report = {"id": report_id, "session_id": session_id, "overall_score": summary["overall_score"], "schema_version": "1.0.0", "created_at": now}
    logger.info("[%s] save 2/3: report %s (score %s, summary keys %s)", session_id, report_id, summary.get("overall_score"), sorted(summary))
    # Replace a previous run's report (and its findings first, which reference it).
    old_ids = [r["id"] for r in supabase.table("reports").select("id").eq("session_id", session_id).execute().data or []]
    if old_ids:
        logger.info("[%s]   replacing %d previous report(s)", session_id, len(old_ids))
        supabase.table("report_findings").delete().in_("report_id", old_ids).execute()
        supabase.table("reports").delete().eq("session_id", session_id).execute()
    errors = []
    for column in ("summary_json", "summary"):
        try:
            supabase.table("reports").insert({**report, column: summary}).execute()
            logger.info("[%s]   report saved with the summary in reports.%s", session_id, column)
            break
        except Exception as e:
            errors.append(f"{column}: {e}")
            logger.warning("[%s]   report insert with reports.%s failed: %s", session_id, column, e)
    else:
        raise RuntimeError("Could not save the report. " + " | ".join(errors))

    # Findings are linked to the report (the table has report_id, not session_id).
    findings = sorted(analysis["findings"] + extra_findings, key=lambda f: f["start_ms"])
    logger.info("[%s] save 3/3: %d findings (%d from ai-service, %d heart-rate)",
                session_id, len(findings), len(analysis["findings"]), len(extra_findings))
    rows = [
        {
            "id": str(uuid4()),
            "report_id": report_id,
            "category": f["category"],
            "start_ms": int(f["start_ms"]),
            "end_ms": int(f["end_ms"]),
            "severity": f["severity"] if f["severity"] in ("low", "medium", "high") else "medium",
            "title": f["title"],
            "details": f.get("details") or {},
        }
        for f in findings
    ]
    if rows:
        try:
            supabase.table("report_findings").insert(rows).execute()
        except Exception as e:
            # One bad row (e.g. a category the table's check constraint doesn't
            # allow) shouldn't lose the whole report: save the rows that fit.
            logger.warning("[%s]   batch findings insert failed (%s); inserting one by one", session_id, str(e)[:160])
            saved = []
            for row in rows:
                try:
                    supabase.table("report_findings").insert(row).execute()
                    saved.append(row)
                except Exception as row_error:
                    logger.warning("[%s]   skipped finding category=%r title=%r: %s",
                                   session_id, row["category"], row["title"], str(row_error)[:160])
            logger.info("[%s]   saved %d of %d findings", session_id, len(saved), len(rows))
            rows = saved
    logger.info("[%s] saved report %s: score %s, %d findings, %d transcript segments",
                session_id, report_id, summary["overall_score"], len(rows), len(segments))


async def analyze_session(session_id: str) -> None:
    """Runs the full analysis and marks the session done, or failed on any error."""
    try:
        session = get_session_by_id(session_id)
        events = _heart_rate_events(session_id)
        payload = {
            "session_id": session_id,
            "audio_url": _signed_audio_url(session_id),
            "questions": [
                {"position": q["position"], "text": q["text"], "asked_at_ms": q.get("asked_at_ms")}
                for q in session["questions"]
            ],
            "resume_text": get_resume_text(str(session["resume_id"])) if session.get("resume_id") else "",
            "job_description": _job_description(str(session["company_id"]), session.get("role_title") or "SWE Intern"),
            "language": "en",
            "heart_rate_events": [
                {"t_ms": e["t_ms"], "bpm_at_trigger": e.get("bpm_at_trigger"), "baseline_bpm": e.get("baseline_bpm"), "text": e.get("text")}
                for e in events
            ],
        }
        logger.info("[%s] sending %d questions and %d heart-rate events to %s/analyze/interview",
                    session_id, len(payload["questions"]), len(events), AI_SERVICE_URL)

        started = time.monotonic()
        async with httpx.AsyncClient(timeout=AI_SERVICE_TIMEOUT_S) as client:
            response = await client.post(f"{AI_SERVICE_URL}/analyze/interview", json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"ai-service returned {response.status_code}: {response.text[:300]}")
        analysis = response.json()
        logger.info("[%s] ai-service answered in %.0fs: score %s, %d segments, %d findings",
                    session_id, time.monotonic() - started, analysis.get("summary", {}).get("overall_score"),
                    len(analysis.get("segments", [])), len(analysis.get("findings", [])))

        _save_results(session_id, analysis, _biometric_findings(events))
        supabase.table("interview_sessions").update({"status": "done"}).eq("id", session_id).execute()
        logger.info("[%s] analysis done", session_id)

    except Exception:
        logger.exception("[%s] analysis failed; marking session as failed", session_id)
        try:
            supabase.table("interview_sessions").update({"status": "failed"}).eq("id", session_id).execute()
        except Exception:
            logger.exception("[%s] could not mark session as failed", session_id)
