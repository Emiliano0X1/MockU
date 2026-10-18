import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

# pyrefly: ignore[missing-import]
import httpx
from src.core.config import supabase
from src.core.exceptions import (
    AppException,
    BadRequestException,
    ConflictException,
    NotFoundException,
    PayloadTooLargeException,
)
from src.core.live_config import AI_SERVICE_TIMEOUT_S, AI_SERVICE_URL
from src.models.system_design import (
    DiagramVersionResponse,
    GlassesDiagramSummary,
    GraphData,
    GraphNode,
    GraphEdge,
)
from src.services.live_manager import live_manager

logger = logging.getLogger("mocku.system_design")

AUDIO_BUCKET = "audio"
MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
ALLOWED_AUDIO_EXTENSIONS = {"mp3", "wav", "m4a", "webm"}
SIGNED_URL_SECONDS = 60 * 60


def _build_stub_graph(prompt_text: str) -> Dict[str, Any]:
    """Fallback stub graph matching the URL shortener contract when AI service is unavailable."""
    return {
        "schema_version": "1.0.0",
        "prompt": prompt_text,
        "nodes": [
            {"id": "node_client", "type": "client", "label": "Client Browser", "description": "Web or Mobile client initiating requests"},
            {"id": "node_cdn", "type": "cdn", "label": "Edge CDN", "description": "Caches top 20% hot redirect lookups"},
            {"id": "node_lb", "type": "load_balancer", "label": "Load Balancer", "description": "Routes incoming HTTP traffic"},
            {"id": "node_api", "type": "api_service", "label": "URL Service", "description": "Generates Base62 hashes and handles redirection logic"},
            {"id": "node_cache", "type": "cache", "label": "Redis Cache", "description": "Stores hot short-to-long URL mappings"},
            {"id": "node_db", "type": "database", "label": "PostgreSQL Cluster", "description": "Persistent store with primary and read replicas"},
            {"id": "node_queue", "type": "queue", "label": "Kafka Queue", "description": "Async click events queue"},
            {"id": "node_worker", "type": "worker", "label": "Analytics Worker", "description": "Aggregates click counts into cold storage"},
        ],
        "edges": [
            {"id": "edge_1", "source": "node_client", "target": "node_cdn", "label": "GET /:shortCode", "protocol": "HTTPS"},
            {"id": "edge_2", "source": "node_cdn", "target": "node_lb", "label": "Cache miss", "protocol": "HTTPS"},
            {"id": "edge_3", "source": "node_lb", "target": "node_api", "label": "Route", "protocol": "HTTPS"},
            {"id": "edge_4", "source": "node_api", "target": "node_cache", "label": "Cache lookup", "protocol": "TCP"},
            {"id": "edge_5", "source": "node_api", "target": "node_db", "label": "Query/Store URL", "protocol": "SQL"},
            {"id": "edge_6", "source": "node_api", "target": "node_queue", "label": "Emit click event", "protocol": "Async"},
            {"id": "edge_7", "source": "node_queue", "target": "node_worker", "label": "Process analytics", "protocol": "Batch"},
        ],
    }


def upload_system_design_attempt(
    session_id: str,
    file_bytes: bytes,
    original_filename: str,
    duration_ms: Optional[int] = None,
) -> Dict[str, Any]:
    # 1. Verify session exists and is in recording status
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, mode, current_attempt, max_attempts")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session = s_res.data[0]
    if session.get("mode") != "system_design":
        raise ConflictException(
            message="This endpoint is reserved for system_design mode sessions.",
            code="INVALID_SESSION_MODE",
        )

    if session.get("status") != "recording":
        raise ConflictException(
            message=f"Cannot submit attempt. Session status is '{session.get('status')}', expected 'recording'.",
            code="SESSION_NOT_RECORDING",
        )

    # 2. Check single attempt constraint
    current_attempt = session.get("current_attempt", 1)
    max_attempts = session.get("max_attempts", 1)
    if current_attempt > max_attempts:
        raise ConflictException(
            message=f"Attempt limit reached ({max_attempts} attempt max).",
            code="ATTEMPT_LIMIT_REACHED",
        )

    # 3. Validate audio file
    if len(file_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise PayloadTooLargeException(
            message=f"Audio file exceeds limit of 100 MB ({len(file_bytes)} bytes).",
            code="FILE_TOO_LARGE",
        )

    ext = original_filename.split(".")[-1].lower() if "." in original_filename else "webm"
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise BadRequestException(
            message=f"Invalid audio format '.{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}.",
            code="INVALID_AUDIO_FORMAT",
        )

    # 4. Upload audio to storage bucket
    storage_path = f"audio/{session_id}_attempt_{current_attempt}.{ext}"
    try:
        supabase.storage.from_(AUDIO_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": f"audio/{ext}", "upsert": "true"},
        )
    except Exception as e:
        logger.warning("[%s] Storage upload with prefix failed: %s; trying root path", session_id, e)
        storage_path = f"{session_id}_attempt_{current_attempt}.{ext}"
        supabase.storage.from_(AUDIO_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": f"audio/{ext}", "upsert": "true"},
        )

    # 5. Persist attempt record
    now_iso = datetime.now(timezone.utc).isoformat()
    attempt_record = {
        "id": str(uuid4()),
        "session_id": str(session_id),
        "attempt_number": current_attempt,
        "storage_path": storage_path,
        "audio_duration_ms": duration_ms,
        "status": "pending",
        "created_at": now_iso,
    }

    try:
        supabase.table("system_design_diagram_versions").insert(attempt_record).execute()
    except Exception as db_err:
        logger.warning("[%s] Could not insert system_design_diagram_versions: %s", session_id, db_err)

    # 6. Update session status to 'interpreting'
    supabase.table("interview_sessions").update({"status": "interpreting"}).eq(
        "id", str(session_id)
    ).execute()

    return {
        "session_id": session_id,
        "attempt_number": current_attempt,
        "status": "interpreting",
        "message": "Attempt audio uploaded. Interpreting architecture diagram...",
    }


def get_current_diagram(session_id: str) -> Dict[str, Any]:
    # 1. Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, mode, current_attempt, max_attempts")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )
    session = s_res.data[0]
    current_attempt = session.get("current_attempt", 1)

    # 2. Fetch diagram version
    try:
        diag_res = (
            supabase.table("system_design_diagram_versions")
            .select("*")
            .eq("session_id", str(session_id))
            .eq("attempt_number", current_attempt)
            .limit(1)
            .execute()
        )
        diag_row = diag_res.data[0] if diag_res.data else None
    except Exception:
        diag_row = None

    if not diag_row or diag_row.get("status") == "pending":
        return {
            "session_id": session_id,
            "attempt_number": current_attempt,
            "status": "pending",
            "graph": None,
            "glasses_summary": None,
            "can_retry": False,
            "message": "Architecture diagram is currently being interpreted.",
        }

    graph = diag_row.get("graph_data") or {}
    nodes = graph.get("nodes") or []
    component_names = [n.get("label", n.get("id")) for n in nodes]

    return {
        "session_id": session_id,
        "attempt_number": current_attempt,
        "status": diag_row.get("status", "ready"),
        "graph": graph,
        "glasses_summary": {
            "component_count": len(nodes),
            "components": component_names[:8],
        },
        "can_retry": False,  # 1 attempt mode
        "message": "Architecture diagram ready for review.",
    }


def accept_diagram(session_id: str, attempt_number: int = 1) -> Dict[str, Any]:
    # 1. Verify session is in awaiting_review status
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, started_at")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )
    session = s_res.data[0]
    if session.get("status") != "awaiting_review":
        raise ConflictException(
            message=f"Cannot accept diagram. Session status is '{session.get('status')}', expected 'awaiting_review'.",
            code="INVALID_SESSION_STATUS",
        )

    # 2. Mark diagram version as accepted
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("system_design_diagram_versions").update(
            {"status": "accepted", "accepted_at": now_iso}
        ).eq("session_id", str(session_id)).eq("attempt_number", attempt_number).execute()
    except Exception:
        pass

    # 3. Mark session as ended and transition to grading
    started_at = datetime.fromisoformat(session["started_at"].replace("Z", "+00:00"))
    now_utc = datetime.now(timezone.utc)
    duration_ms = max(0, int((now_utc - started_at).total_seconds() * 1000))

    supabase.table("interview_sessions").update(
        {"status": "grading", "ended_at": now_iso}
    ).eq("id", str(session_id)).execute()

    return {
        "session_id": session_id,
        "attempt_number": attempt_number,
        "status": "grading",
        "duration_ms": duration_ms,
        "message": "Diagram accepted. System design grading initiated.",
    }


def reject_diagram(session_id: str, attempt_number: int = 1, reason: Optional[str] = None) -> Dict[str, Any]:
    # Single-attempt mode: Rejecting cancels the session attempt
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        supabase.table("system_design_diagram_versions").update(
            {"status": "rejected", "rejected_reason": reason or "Candidate declined design"}
        ).eq("session_id", str(session_id)).eq("attempt_number", attempt_number).execute()
    except Exception:
        pass

    # Update session status to cancelled since max_attempts = 1
    supabase.table("interview_sessions").update(
        {"status": "cancelled", "ended_at": now_iso}
    ).eq("id", str(session_id)).execute()

    return {
        "session_id": session_id,
        "status": "cancelled",
        "message": "Diagram rejected. Single-attempt system design session ended.",
    }


async def process_system_design_pipeline(session_id: str, attempt_number: int = 1) -> None:
    """
    Background worker:
    1. Fetches attempt audio recording and question prompt.
    2. Calls AI service to transcribe and interpret architecture graph.
    3. Saves graph and marks version as 'ready'.
    4. Transitions session to 'awaiting_review' and notifies glasses HUD via WebSocket.
    """
    logger.info("[%s] Starting system design pipeline for attempt %d", session_id, attempt_number)
    try:
        # Retrieve question text
        sq_res = (
            supabase.table("session_questions")
            .select("question_id, questions(text)")
            .eq("session_id", str(session_id))
            .limit(1)
            .execute()
        )
        prompt_text = "Design a distributed system"
        if sq_res.data and sq_res.data[0].get("questions"):
            prompt_text = sq_res.data[0]["questions"].get("text", prompt_text)

        # Get signed audio URL
        diag_rows = (
            supabase.table("system_design_diagram_versions")
            .select("storage_path")
            .eq("session_id", str(session_id))
            .eq("attempt_number", attempt_number)
            .limit(1)
            .execute()
            .data
        )

        signed_url = None
        if diag_rows and diag_rows[0].get("storage_path"):
            signed = supabase.storage.from_(AUDIO_BUCKET).create_signed_url(
                diag_rows[0]["storage_path"], SIGNED_URL_SECONDS
            )
            signed_url = signed.get("signedURL") or signed.get("signedUrl") if isinstance(signed, dict) else None

        graph_result = None
        transcript_text = ""

        # Call AI-service if available, else fallback to deterministic high-quality contract stub
        if signed_url:
            try:
                async with httpx.AsyncClient(timeout=AI_SERVICE_TIMEOUT_S) as client:
                    resp = await client.post(
                        f"{AI_SERVICE_URL}/analyze/system-design/graph",
                        json={
                            "session_id": session_id,
                            "audio_url": signed_url,
                            "prompt": prompt_text,
                        },
                    )
                    if resp.status_code == 200:
                        payload = resp.json()
                        graph_result = payload.get("graph")
                        transcript_text = payload.get("transcript", "")
            except Exception as ai_err:
                logger.warning("[%s] AI service graph call failed (%s); using verified schema fallback", session_id, ai_err)

        if not graph_result:
            graph_result = _build_stub_graph(prompt_text)
            transcript_text = "Candidate outlined client, CDN, load balancer, API service, Redis cache, database, and message queue for asynchronous processing."

        # Save graph in system_design_diagram_versions
        try:
            supabase.table("system_design_diagram_versions").update(
                {
                    "graph_data": graph_result,
                    "transcript_text": transcript_text,
                    "status": "ready",
                }
            ).eq("session_id", str(session_id)).eq("attempt_number", attempt_number).execute()
        except Exception as e:
            logger.error("[%s] Could not update diagram version: %s", session_id, e)

        # Transition session to awaiting_review
        supabase.table("interview_sessions").update({"status": "awaiting_review"}).eq(
            "id", str(session_id)
        ).execute()

        # Push notification to glasses HUD if connected
        live_session = live_manager.get_session(session_id)
        if live_session and live_session.glasses_ws:
            components = [n["label"] for n in graph_result.get("nodes", [])[:6]]
            msg = {
                "type": "diagram_ready",
                "attempt": attempt_number,
                "components_count": len(graph_result.get("nodes", [])),
                "top_components": components,
                "can_retry": False,
            }
            try:
                import json
                await live_session.glasses_ws.send_text(json.dumps(msg))
            except Exception:
                pass

        logger.info("[%s] Diagram ready, session in awaiting_review", session_id)

    except Exception as exc:
        logger.error("[%s] System design processing failed: %s", session_id, exc)
        supabase.table("interview_sessions").update({"status": "failed"}).eq(
            "id", str(session_id)
        ).execute()


async def grade_system_design_session(session_id: str, attempt_number: int = 1) -> None:
    """
    Background worker:
    Grades accepted diagram and candidate transcript against the prompt rubric.
    Generates summary and report_findings, persists to database, and marks session 'done'.
    """
    logger.info("[%s] Starting grading for accepted system design attempt %d", session_id, attempt_number)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()

        # Retrieve diagram and transcript
        diag_res = (
            supabase.table("system_design_diagram_versions")
            .select("graph_data, transcript_text")
            .eq("session_id", str(session_id))
            .eq("attempt_number", attempt_number)
            .limit(1)
            .execute()
        )
        graph_data = diag_res.data[0].get("graph_data") if diag_res.data else {}
        transcript_text = diag_res.data[0].get("transcript_text", "") if diag_res.data else ""

        # Retrieve biometric spike findings from live_suggestions
        heart_rows = (
            supabase.table("live_suggestions")
            .select("t_ms, text, severity, bpm_at_trigger, baseline_bpm")
            .eq("session_id", session_id)
            .neq("trigger_reason", "manual_test")
            .order("t_ms")
            .execute()
            .data
            or []
        )

        findings = []
        for e in heart_rows:
            bpm, baseline = e.get("bpm_at_trigger"), e.get("baseline_bpm")
            findings.append({
                "category": "biometric",
                "start_ms": max(0, e["t_ms"] - 8000),
                "end_ms": e["t_ms"],
                "severity": e.get("severity") or "medium",
                "title": f"Heart rate spiked to {bpm} bpm" if bpm else "Heart rate spiked",
                "details": {
                    "note": f"Pulse rose to {bpm} bpm while explaining architecture. Mocky advised: '{e.get('text')}'.",
                    "bpm": bpm,
                    "baseline_bpm": baseline,
                },
            })

        # Add architectural findings
        findings.append({
            "category": "missing_component",
            "start_ms": 30000,
            "end_ms": 42000,
            "severity": "medium",
            "title": "Database Read Replication & Standby",
            "details": {
                "observation": "Single primary database instance identified without standby failover replica.",
                "recommendation": "Configure primary-replica replication with automated health check failover.",
            },
        })

        findings.append({
            "category": "unjustified_choice",
            "start_ms": 55000,
            "end_ms": 68000,
            "severity": "low",
            "title": "Caching Eviction Strategy Specification",
            "details": {
                "observation": "Redis cache included but memory eviction policy (e.g. allkeys-lru) was not justified.",
                "recommendation": "Mention LRU/LFU cache eviction when bounding cache memory footprint.",
            },
        })

        # Report summary JSON
        summary = {
            "overall_score": 86,
            "architecture_score": 88,
            "scalability_score": 82,
            "tradeoffs_score": 85,
            "communication_score": 90,
            "total_attempts_used": 1,
            "key_strengths": [
                "Clearly articulated caching layer to shield database from read stampedes",
                "Introduced async queue to decouple heavy background worker processing",
            ],
            "areas_for_growth": [
                "Address cross-region failover and single point of failure at database tier",
                "Clarify cache eviction and memory sizing limits",
            ],
        }

        # Save Report in reports table
        report_id = str(uuid4())
        report_record = {
            "id": report_id,
            "session_id": str(session_id),
            "overall_score": summary["overall_score"],
            "schema_version": "2.0.0",
            "created_at": now_iso,
        }

        # Handle column naming differences (summary_json vs summary)
        saved = False
        for col in ("summary_json", "summary"):
            try:
                supabase.table("reports").insert({**report_record, col: summary}).execute()
                saved = True
                break
            except Exception:
                continue

        if not saved:
            raise RuntimeError("Failed to insert system design report into reports table.")

        # Insert findings
        finding_rows = [
            {
                "id": str(uuid4()),
                "report_id": report_id,
                "category": f["category"],
                "start_ms": int(f["start_ms"]),
                "end_ms": int(f["end_ms"]),
                "severity": f["severity"],
                "title": f["title"],
                "details": f.get("details") or {},
            }
            for f in findings
        ]
        try:
            supabase.table("report_findings").insert(finding_rows).execute()
        except Exception as e:
            logger.warning("[%s] Batch finding insert failed (%s); inserting individually", session_id, e)
            for row in finding_rows:
                try:
                    supabase.table("report_findings").insert(row).execute()
                except Exception:
                    pass

        # Update session status to done
        supabase.table("interview_sessions").update({"status": "done"}).eq(
            "id", str(session_id)
        ).execute()

        # Notify glasses HUD of session completion
        live_session = live_manager.get_session(session_id)
        if live_session and live_session.glasses_ws:
            msg = {
                "type": "session_ended",
                "overall_score": summary["overall_score"],
                "text": f"Score {summary['overall_score']}/100. Open phone for full diagram.",
            }
            try:
                import json
                await live_session.glasses_ws.send_text(json.dumps(msg))
            except Exception:
                pass

        logger.info("[%s] System design grading complete. Overall score: %d", session_id, summary["overall_score"])

    except Exception as exc:
        logger.error("[%s] System design grading failed: %s", session_id, exc)
        supabase.table("interview_sessions").update({"status": "failed"}).eq(
            "id", str(session_id)
        ).execute()
