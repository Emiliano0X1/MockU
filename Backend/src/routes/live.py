import asyncio
from datetime import datetime, timezone
import json
from uuid import UUID, uuid4
from fastapi import (
    APIRouter,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from src.core.config import supabase
from src.core.exceptions import ConflictException, NotFoundException
from src.core.live_config import detector_config
from src.models.suggestion import (
    SuggestionListResponse,
    TestSuggestionRequest,
    TestSuggestionResponse,
)
from src.services.live_manager import live_manager

router = APIRouter(tags=["Live Mode"])


@router.websocket("/ws/sessions/{id}/glasses")
@router.websocket("/api/v1/ws/sessions/{id}/glasses")
async def glasses_websocket_endpoint(websocket: WebSocket, id: UUID):
    """
    WebSocket endpoint for the smart glasses companion app.
    Streams real-time BPM suggestions and sensor status.
    Accepts client acknowledgments ('ack') and 'pong'.
    """
    session_id = str(id)

    # 1. Verify session exists and is currently recording
    res = (
        supabase.table("interview_sessions")
        .select("id, status, started_at")
        .eq("id", session_id)
        .execute()
    )
    if not res.data:
        await websocket.close(code=4404, reason="Session not found")
        return

    session_row = res.data[0]
    if session_row.get("status") != "recording":
        await websocket.close(code=4409, reason="Session is not in recording status")
        return

    await websocket.accept()

    # 2. Register with LiveSessionManager
    session = await live_manager.register_glasses(
        session_id=session_id,
        ws=websocket,
        started_at_iso=session_row["started_at"],
    )

    try:
        while True:
            text_data = await websocket.receive_text()
            try:
                data = json.loads(text_data)
                msg_type = data.get("type")

                # Handle client acknowledgment
                if msg_type == "ack":
                    suggestion_id = data.get("suggestion_id")
                    if suggestion_id:
                        now_iso = datetime.now(timezone.utc).isoformat()
                        try:
                            supabase.table("live_suggestions").update(
                                {"delivered_at": now_iso}
                            ).eq("id", str(suggestion_id)).execute()
                        except Exception:
                            pass

                # Handle pong
                elif msg_type == "pong":
                    pass

            except json.JSONDecodeError:
                pass

    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        live_manager.unregister_glasses(session_id, websocket)


@router.get("/api/v1/sessions/{id}/suggestions", response_model=SuggestionListResponse, status_code=status.HTTP_200_OK)
def handle_list_suggestions(
    id: UUID,
    include_test: bool = Query(False, description="Whether to include manual_test suggestions"),
):
    """List warnings pushed to glasses during an interview session."""
    session_id = str(id)

    # Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id")
        .eq("id", session_id)
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    # Query suggestions ordered by t_ms
    query = (
        supabase.table("live_suggestions")
        .select("*")
        .eq("session_id", session_id)
    )
    if not include_test:
        query = query.neq("trigger_reason", "manual_test")

    res = query.order("t_ms").execute()
    return {"session_id": id, "items": res.data or []}


@router.post("/api/v1/sessions/{id}/suggestions/test", response_model=TestSuggestionResponse, status_code=status.HTTP_202_ACCEPTED)
async def handle_send_test_suggestion(
    id: UUID,
    payload: TestSuggestionRequest,
):
    """
    Send a manual test suggestion directly to the connected glasses HUD.
    Useful for frontend testing without requiring an active watch or real pulse spike.
    """
    session_id = str(id)

    # 1. Verify session exists and is recording
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, started_at")
        .eq("id", session_id)
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session_row = s_res.data[0]
    if session_row.get("status") != "recording":
        raise ConflictException(
            message=f"Session is in '{session_row.get('status')}' status, expected 'recording'.",
            code="SESSION_NOT_RECORDING",
        )

    # 2. Verify an active glasses WebSocket connection exists
    live_sess = live_manager.get_session(session_id)
    if not live_sess or not live_sess.glasses_ws:
        raise ConflictException(
            message="No active glasses WebSocket connection for this session.",
            code="NO_GLASSES_CONNECTED",
        )

    # 3. Calculate current t_ms
    started_at = datetime.fromisoformat(session_row["started_at"].replace("Z", "+00:00"))
    now_utc = datetime.now(timezone.utc)
    t_ms = max(0, int((now_utc - started_at).total_seconds() * 1000))

    suggestion_id = str(uuid4())
    text = payload.text or "Test: take a slow breath"
    severity = payload.severity or "medium"

    # Save to database
    row = {
        "id": suggestion_id,
        "session_id": session_id,
        "t_ms": t_ms,
        "text": text,
        "severity": severity,
        "trigger_reason": "manual_test",
        "bpm_at_trigger": live_sess.last_bpm,
        "baseline_bpm": live_sess.detector_state.baseline_bpm,
        "delivered_at": None,
        "created_at": now_utc.isoformat(),
    }
    try:
        supabase.table("live_suggestions").insert(row).execute()
    except Exception:
        pass

    # Push to glasses
    delivered = await live_manager.push_suggestion(
        session=live_sess,
        suggestion_id=suggestion_id,
        t_ms=t_ms,
        text=text,
        severity=severity,
        ttl_ms=detector_config.TTL_MS,
    )

    return {"id": suggestion_id, "delivered": delivered}
