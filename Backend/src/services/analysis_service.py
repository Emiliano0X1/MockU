"""
Post-interview analysis: sends the session's recording and context to the
ai-service (ai-service/app/main.py, POST /analyze/interview) and stores what
comes back as transcript_segments, a report and report_findings.
"""
import logging
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
    supabase.table("transcript_segments").delete().eq("session_id", session_id).execute()
    segments = [{"id": str(uuid4()), "session_id": session_id, **s} for s in analysis["segments"]]
    if segments:
        supabase.table("transcript_segments").insert(segments).execute()

    # Report. The summary needs a `summary jsonb` column on reports; without it,
    # save the score anyway so the session still completes.
    summary = analysis["summary"]
    report_id = str(uuid4())
    report = {"id": report_id, "session_id": session_id, "overall_score": summary["overall_score"], "schema_version": "1.0.0", "created_at": now}
    try:
        supabase.table("reports").insert({**report, "summary": summary}).execute()
    except Exception as e:
        logger.warning(
            "[%s] reports.summary could not be saved (%s). Add it in Supabase: "
            "alter table reports add column summary jsonb default '{}'::jsonb;",
            session_id, str(e)[:120],
        )
        supabase.table("reports").insert(report).execute()

    # Findings are linked to the report (the table has report_id, not session_id).
    findings = sorted(analysis["findings"] + extra_findings, key=lambda f: f["start_ms"])
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
        supabase.table("report_findings").insert(rows).execute()
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

        async with httpx.AsyncClient(timeout=AI_SERVICE_TIMEOUT_S) as client:
            response = await client.post(f"{AI_SERVICE_URL}/analyze/interview", json=payload)
        if response.status_code != 200:
            raise RuntimeError(f"ai-service returned {response.status_code}: {response.text[:300]}")

        _save_results(session_id, response.json(), _biometric_findings(events))
        supabase.table("interview_sessions").update({"status": "done"}).eq("id", session_id).execute()
        logger.info("[%s] analysis done", session_id)

    except Exception:
        logger.exception("[%s] analysis failed; marking session as failed", session_id)
        try:
            supabase.table("interview_sessions").update({"status": "failed"}).eq("id", session_id).execute()
        except Exception:
            logger.exception("[%s] could not mark session as failed", session_id)
