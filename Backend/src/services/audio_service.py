import asyncio
from datetime import datetime, timezone
import os
from typing import Any, Dict, Optional
from uuid import uuid4
from src.core.config import supabase
from src.core.exceptions import (
    AppException,
    BadRequestException,
    ConflictException,
    NotFoundException,
    PayloadTooLargeException,
)
from src.services.resume_service import get_resume_text

AUDIO_BUCKET = "audio"
MAX_AUDIO_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
ALLOWED_AUDIO_EXTENSIONS = {"mp3", "wav", "m4a", "webm"}


def upload_audio_and_start_processing(
    session_id: str,
    file_bytes: bytes,
    original_filename: str,
    duration_ms: Optional[int] = None,
) -> Dict[str, Any]:
    # 1. Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, ended_at, resume_id")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session = s_res.data[0]

    # Verify ended_at is set (409 otherwise)
    if not session.get("ended_at"):
        raise ConflictException(
            message="Session must be marked as ended before uploading audio.",
            code="SESSION_NOT_ENDED",
        )

    # Verify no audio exists yet for this session (409 otherwise)
    existing_audio = (
        supabase.table("audio_recordings")
        .select("id")
        .eq("session_id", str(session_id))
        .execute()
    )
    if existing_audio.data and len(existing_audio.data) > 0:
        raise ConflictException(
            message=f"Audio recording already exists for session '{session_id}'.",
            code="AUDIO_ALREADY_EXISTS",
        )

    # 2. Validate file type and size
    if len(file_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise PayloadTooLargeException(
            message=f"Audio file exceeds limit of 100 MB ({len(file_bytes)} bytes).",
            code="FILE_TOO_LARGE",
        )

    ext = original_filename.split(".")[-1].lower() if "." in original_filename else ""
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise BadRequestException(
            message=f"Invalid audio format '.{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}.",
            code="INVALID_AUDIO_FORMAT",
        )

    # 3. Upload to Storage bucket 'audio' at audio/<session_id>.<ext>
    storage_path = f"audio/{session_id}.{ext}"
    try:
        supabase.storage.from_(AUDIO_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": f"audio/{ext}", "upsert": "true"},
        )
    except Exception as e:
        # Fallback to direct name in bucket if folder structure differs
        try:
            storage_path = f"{session_id}.{ext}"
            supabase.storage.from_(AUDIO_BUCKET).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": f"audio/{ext}", "upsert": "true"},
            )
        except Exception as storage_err:
            raise AppException(
                message=f"Failed to upload audio to storage: {str(storage_err)}",
                code="STORAGE_UPLOAD_ERROR",
                status_code=500,
            )

    # 4. Insert audio_recordings row
    audio_record = {
        "id": str(uuid4()),
        "session_id": str(session_id),
        "storage_path": storage_path,
        "duration_ms": duration_ms,
        #"file_format": ext,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        supabase.table("audio_recordings").insert(audio_record).execute()
    except Exception as db_err:
        raise AppException(
            message=f"Failed to record audio metadata: {str(db_err)}",
            code="DATABASE_ERROR",
            status_code=500,
        )

    # 5. Set session status to 'processing'
    supabase.table("interview_sessions").update({"status": "processing"}).eq(
        "id", str(session_id)
    ).execute()

    return {"session_id": session_id, "status": "processing"}


async def run_post_interview_pipeline(session_id: str) -> None:
    """
    Background worker: sends the recording to the ai-service and stores the
    transcript, report and findings (see analysis_service.analyze_session).
    Marks the session 'done', or 'failed' on any error.
    """
    from src.services.analysis_service import analyze_session

    await analyze_session(str(session_id))
