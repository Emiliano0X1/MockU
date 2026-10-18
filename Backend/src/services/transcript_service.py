from typing import Any, Dict
from src.core.config import supabase
from src.core.exceptions import NotFoundException


def get_session_transcript(session_id: str) -> Dict[str, Any]:
    # 1. Verify session exists
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

    session_status = s_res.data[0].get("status", "recording")

    # 2. Fetch transcript segments ordered by start_ms
    t_res = (
        supabase.table("transcript_segments")
        .select("start_ms, end_ms, text")
        .eq("session_id", str(session_id))
        .order("start_ms")
        .execute()
    )

    segments = []
    for item in t_res.data or []:
        segments.append(
            {
                "start_ms": item.get("start_ms", 0),
                "end_ms": item.get("end_ms", 0),
                "text": item.get("text", ""),
            }
        )

    return {
        "session_id": session_id,
        "status": session_status,
        "segments": segments,
    }
