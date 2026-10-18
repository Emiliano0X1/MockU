import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4
from src.core.config import supabase
from src.core.exceptions import (
    AppException,
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
)
from src.services.company_service import get_company_by_id
from src.services.profile_service import get_profile_by_id
from src.services.resume_service import get_resume_by_id

AUDIO_BUCKET = "audio"


def create_session(
    profile_id: str,
    company_id: str,
    resume_id: str,
    role_title: str = "SWE Intern",
    question_count: int = 6,
) -> Dict[str, Any]:
    # 1. Verify existence of profile, company, resume
    get_profile_by_id(profile_id)
    get_company_by_id(company_id)
    resume = get_resume_by_id(resume_id)

    # Verify resume belongs to that profile (check profile_id or user_id)
    resume_owner = resume.get("profile_id") or resume.get("user_id")
    if resume_owner and str(resume_owner) != str(profile_id):
        raise UnprocessableEntityException(
            message=f"Resume '{resume_id}' does not belong to profile '{profile_id}'.",
            code="RESUME_PROFILE_MISMATCH",
        )

    # 2. Prepare interview_sessions row
    session_id = str(uuid4())
    started_at = datetime.now(timezone.utc).isoformat()

    base_record = {
        "id": session_id,
        "company_id": str(company_id),
        "resume_id": str(resume_id),
        "role_title": role_title or "SWE Intern",
        "status": "recording",
        "started_at": started_at,
        "ended_at": None,
    }

    # Attempt insert with profile_id, fallback to user_id for schema compatibility
    try:
        res = (
            supabase.table("interview_sessions")
            .insert({**base_record, "profile_id": str(profile_id)})
            .execute()
        )
    except Exception:
        res = (
            supabase.table("interview_sessions")
            .insert({**base_record, "user_id": str(profile_id)})
            .execute()
        )

    if not res.data:
        raise RuntimeError("Failed to create interview session.")

    created_session = res.data[0]

    # 3. Pick question_count random questions from question bank
    try:
        q_res = (
            supabase.table("questions")
            .select("id, text, category, company_id")
            .execute()
        )
        all_questions = q_res.data or []

        eligible = [
            q
            for q in all_questions
            if q.get("company_id") is None
            or str(q.get("company_id")) == str(company_id)
        ]

        if not eligible:
            eligible = all_questions

        sample_size = min(question_count, len(eligible))
        chosen_questions = (
            random.sample(eligible, sample_size) if sample_size > 0 else []
        )

        # 4. Insert session_questions
        session_questions_data = []
        questions_output = []

        for idx, q in enumerate(chosen_questions, start=1):
            q_id = str(q["id"])
            session_questions_data.append(
                {
                    "session_id": session_id,
                    "question_id": q_id,
                    "position": idx,
                    "asked_at_ms": None,
                }
            )
            questions_output.append(
                {
                    "position": idx,
                    "question_id": q_id,
                    "text": q.get("text", ""),
                    "category": q.get("category", "General"),
                    "asked_at_ms": None,
                }
            )

        if session_questions_data:
            sq_res = (
                supabase.table("session_questions")
                .insert(session_questions_data)
                .execute()
            )
            if not sq_res.data:
                raise RuntimeError("Failed to link questions to interview session.")

    except Exception as e:
        # Clean up session if question linking fails
        try:
            supabase.table("interview_sessions").delete().eq("id", session_id).execute()
        except Exception:
            pass
        raise AppException(
            message=f"Failed to initialize session questions: {str(e)}",
            code="SESSION_INIT_ERROR",
            status_code=500,
        )

    return {
        "id": session_id,
        "status": "recording",
        "started_at": created_session.get("started_at", started_at),
        "company_id": company_id,
        "resume_id": resume_id,
        "role_title": role_title or "SWE Intern",
        "questions": questions_output,
    }


def get_session_by_id(session_id: str) -> Dict[str, Any]:
    # 1. Check session existence
    s_res = (
        supabase.table("interview_sessions")
        .select("*")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )
    session = s_res.data[0]

    # 2. Fetch session questions ordered by position
    sq_res = (
        supabase.table("session_questions")
        .select("position, question_id, asked_at_ms, questions(text, category)")
        .eq("session_id", str(session_id))
        .order("position")
        .execute()
    )

    questions_list = []
    for row in sq_res.data or []:
        q_info = row.get("questions") or {}
        questions_list.append(
            {
                "position": row["position"],
                "question_id": row["question_id"],
                "text": q_info.get("text", ""),
                "category": q_info.get("category", "General"),
                "asked_at_ms": row.get("asked_at_ms"),
            }
        )

    # 3. Compute has_audio
    audio_res = (
        supabase.table("audio_recordings")
        .select("id")
        .eq("session_id", str(session_id))
        .limit(1)
        .execute()
    )
    has_audio = bool(audio_res.data and len(audio_res.data) > 0)

    # 4. Compute report_ready
    report_ready = session.get("status") == "done"

    return {
        "id": session["id"],
        "status": session["status"],
        "company_id": session["company_id"],
        "resume_id": session["resume_id"],
        "role_title": session.get("role_title", "SWE Intern"),
        "started_at": session["started_at"],
        "ended_at": session.get("ended_at"),
        "has_audio": has_audio,
        "report_ready": report_ready,
        "questions": questions_list,
    }


def record_question_shown(
    session_id: str, position: int, asked_at_ms: int
) -> Dict[str, Any]:
    # 1. Verify session exists and status is "recording"
    s_res = (
        supabase.table("interview_sessions")
        .select("status")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    status = s_res.data[0].get("status")
    if status != "recording":
        raise ConflictException(
            message=f"Cannot record question timing. Session status is '{status}', expected 'recording'.",
            code="SESSION_NOT_RECORDING",
        )

    # 2. Validate asked_at_ms >= 0
    if asked_at_ms < 0:
        raise UnprocessableEntityException(
            message="asked_at_ms must be greater than or equal to 0.",
            code="INVALID_TIMESTAMP",
        )

    # Fetch all questions for this session ordered by position
    sq_res = (
        supabase.table("session_questions")
        .select("position, asked_at_ms")
        .eq("session_id", str(session_id))
        .order("position")
        .execute()
    )
    all_sq = sq_res.data or []

    current_item = next((item for item in all_sq if item["position"] == position), None)
    if not current_item:
        raise NotFoundException(
            message=f"Question at position {position} not found in session '{session_id}'.",
            code="QUESTION_POSITION_NOT_FOUND",
        )

    # 3. Reject if lower than asked_at_ms of previous question
    if position > 1:
        prev_item = next((item for item in all_sq if item["position"] == position - 1), None)
        if prev_item and prev_item.get("asked_at_ms") is not None:
            if asked_at_ms < prev_item["asked_at_ms"]:
                raise UnprocessableEntityException(
                    message=f"asked_at_ms ({asked_at_ms}) cannot be earlier than previous question ({prev_item['asked_at_ms']}).",
                    code="TIMESTAMP_SEQUENCE_ERROR",
                )

    # 4. Check if current question already has a value
    current_val = current_item.get("asked_at_ms")
    if current_val is not None:
        if current_val == asked_at_ms:
            return {"position": position, "asked_at_ms": asked_at_ms}
        else:
            raise ConflictException(
                message=f"Question at position {position} already has asked_at_ms recorded ({current_val}).",
                code="QUESTION_ALREADY_SHOWN",
            )

    # 5. Update row
    res = (
        supabase.table("session_questions")
        .update({"asked_at_ms": asked_at_ms})
        .eq("session_id", str(session_id))
        .eq("position", position)
        .execute()
    )
    if not res.data:
        raise RuntimeError(f"Failed to update asked_at_ms for question {position}.")

    return {"position": position, "asked_at_ms": asked_at_ms}


def end_session(session_id: str) -> Dict[str, Any]:
    # 1. Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status, started_at, ended_at")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session = s_res.data[0]
    started_at_str = session["started_at"]
    started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))

    # 2. If status is not recording, 409
    if session["status"] != "recording":
        raise ConflictException(
            message=f"Cannot end session. Session is in '{session['status']}' state.",
            code="SESSION_NOT_RECORDING",
        )

    # 3. If ended_at is already set, return idempotent response
    if session.get("ended_at"):
        ended_at = datetime.fromisoformat(session["ended_at"].replace("Z", "+00:00"))
        duration_ms = int((ended_at - started_at).total_seconds() * 1000)
        return {
            "id": session["id"],
            "status": "recording",
            "ended_at": session["ended_at"],
            "duration_ms": max(0, duration_ms),
        }

    # 4. Set ended_at = now
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    duration_ms = int((now_dt - started_at).total_seconds() * 1000)

    res = (
        supabase.table("interview_sessions")
        .update({"ended_at": now_iso})
        .eq("id", str(session_id))
        .execute()
    )
    if not res.data:
        raise RuntimeError(f"Failed to end session '{session_id}'.")

    return {
        "id": session["id"],
        "status": "recording",
        "ended_at": now_iso,
        "duration_ms": max(0, duration_ms),
    }


def list_sessions(
    profile_id: str,
    status: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
) -> Dict[str, Any]:
    """
    List candidate interview sessions history.
    Includes company name and report overall_score.
    """
    # 1. Verify profile exists
    get_profile_by_id(profile_id)

    # 2. Query sessions for profile
    limit = min(max(1, limit), 50)
    offset = max(0, offset)

    # Try profile_id first, fallback to user_id
    query = (
        supabase.table("interview_sessions")
        .select("id, role_title, status, started_at, ended_at, company_id, companies(id, name), reports(overall_score)", count="exact")
        .eq("profile_id", str(profile_id))
    )
    if status:
        query = query.eq("status", status)

    res = query.order("started_at", desc=True).range(offset, offset + limit - 1).execute()

    if not res.data and res.count == 0:
        # Fallback query using user_id column
        fallback_query = (
            supabase.table("interview_sessions")
            .select("id, role_title, status, started_at, ended_at, company_id, companies(id, name), reports(overall_score)", count="exact")
            .eq("user_id", str(profile_id))
        )
        if status:
            fallback_query = fallback_query.eq("status", status)
        res = fallback_query.order("started_at", desc=True).range(offset, offset + limit - 1).execute()

    rows = res.data or []
    total_count = res.count if res.count is not None else len(rows)

    items = []
    for r in rows:
        started_at = datetime.fromisoformat(r["started_at"].replace("Z", "+00:00"))
        duration_ms = None
        if r.get("ended_at"):
            ended_at = datetime.fromisoformat(r["ended_at"].replace("Z", "+00:00"))
            duration_ms = max(0, int((ended_at - started_at).total_seconds() * 1000))

        company_data = r.get("companies") or {}
        company_obj = {
            "id": r.get("company_id") or company_data.get("id"),
            "name": company_data.get("name", "Mock Company"),
        }

        # reports relation can be a list or a dict
        report_data = r.get("reports")
        overall_score = None
        if isinstance(report_data, list) and len(report_data) > 0:
            overall_score = report_data[0].get("overall_score")
        elif isinstance(report_data, dict):
            overall_score = report_data.get("overall_score")

        items.append(
            {
                "id": r["id"],
                "company": company_obj,
                "role_title": r.get("role_title"),
                "status": r["status"],
                "started_at": r["started_at"],
                "ended_at": r.get("ended_at"),
                "duration_ms": duration_ms,
                "overall_score": overall_score,
            }
        )

    return {"items": items, "total": total_count}


def reprocess_session(session_id: str) -> Dict[str, Any]:
    """
    Re-run the analysis for a finished interview (status 'done' or 'failed').
    Deletes existing report, findings, and transcript_segments before restarting.
    """
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

    current_status = s_res.data[0].get("status")

    # 2. Re-process only allowed for 'done' or 'failed'
    if current_status in ["recording", "processing"]:
        raise ConflictException(
            message=f"Cannot reprocess session in '{current_status}' status. Only 'done' or 'failed' sessions can be reprocessed.",
            code="SESSION_STATUS_CONFLICT",
        )

    # 3. Verify audio exists
    a_res = (
        supabase.table("audio_recordings")
        .select("id")
        .eq("session_id", str(session_id))
        .execute()
    )
    if not a_res.data:
        raise ConflictException(
            message="Cannot reprocess session without an audio recording.",
            code="AUDIO_MISSING",
        )

    # 4. Clear existing reports and transcript segments
    try:
        supabase.table("report_findings").delete().eq("session_id", str(session_id)).execute()
    except Exception:
        pass

    try:
        supabase.table("reports").delete().eq("session_id", str(session_id)).execute()
    except Exception:
        pass

    try:
        supabase.table("transcript_segments").delete().eq("session_id", str(session_id)).execute()
    except Exception:
        pass

    # 5. Set status to processing
    supabase.table("interview_sessions").update({"status": "processing"}).eq(
        "id", str(session_id)
    ).execute()

    return {"session_id": session_id, "status": "processing"}


def delete_session(session_id: str) -> None:
    """
    Privacy cleanup: remove session and all related records and audio file.
    Storage file is deleted first to avoid orphan files.
    """
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

    current_status = s_res.data[0].get("status")
    if current_status == "processing":
        raise ConflictException(
            message="Cannot delete session while it is processing.",
            code="SESSION_PROCESSING_CONFLICT",
        )

    # 2. Read audio storage path if available
    a_res = (
        supabase.table("audio_recordings")
        .select("storage_path")
        .eq("session_id", str(session_id))
        .execute()
    )
    audio_path = a_res.data[0].get("storage_path") if a_res.data else None

    # 3. Delete audio from Storage first
    if audio_path:
        try:
            supabase.storage.from_(AUDIO_BUCKET).remove([audio_path])
        except Exception:
            pass

    # 4. Delete session row (cascades to related tables)
    try:
        supabase.table("interview_sessions").delete().eq("id", str(session_id)).execute()
    except Exception as e:
        raise AppException(
            message=f"Failed to delete session record: {str(e)}",
            code="DATABASE_DELETE_ERROR",
            status_code=500,
        )
