from datetime import datetime, timezone
from typing import Any, Dict
from uuid import uuid4
from src.core.config import supabase
from src.core.exceptions import (
    AppException,
    ConflictException,
    NotFoundException,
)
from src.services.profile_service import get_profile_by_id
from src.utils.pdf import (
    extract_text_from_pdf,
    validate_pdf_bytes,
)

RESUMES_BUCKET = "resumes"


def upload_and_parse_resume(
    file_bytes: bytes, original_filename: str, profile_id: str
) -> Dict[str, Any]:
    # 1. Verify profile exists (404 if not found)
    get_profile_by_id(profile_id)

    # 2. Validate PDF bytes and file size
    validate_pdf_bytes(file_bytes, original_filename)

    # 3, 4 & 5. Extract and clean text (raises 422 if empty/scanned)
    clean_text = extract_text_from_pdf(file_bytes)

    # 6. Generate resume id and storage path
    resume_id = str(uuid4())
    storage_filename = f"{resume_id}.pdf"
    storage_path = f"resumes/{storage_filename}"

    # Upload PDF file to Supabase Storage bucket 'resumes'
    upload_success = False
    try:
        supabase.storage.from_(RESUMES_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"},
        )
        upload_success = True
    except Exception:
        # Fallback to bucket root if subfolder is not supported
        try:
            supabase.storage.from_(RESUMES_BUCKET).upload(
                path=storage_filename,
                file=file_bytes,
                file_options={"content-type": "application/pdf", "upsert": "true"},
            )
            storage_path = storage_filename
            upload_success = True
        except Exception as storage_err:
            raise AppException(
                message=f"Failed to upload resume to storage: {str(storage_err)}",
                code="STORAGE_UPLOAD_ERROR",
                status_code=500,
            )

    # 7. Insert resumes row into database
    created_at = datetime.now(timezone.utc).isoformat()
    base_record = {
        "id": resume_id,
        "pdf_storage_path": storage_path,
        "raw_text": clean_text,
        "original_filename": original_filename,
        "created_at": created_at,
    }

    try:
        # Attempt insert with profile_id, fallback to user_id for schema compatibility
        try:
            res = (
                supabase.table("resumes")
                .insert({**base_record, "profile_id": str(profile_id)})
                .execute()
            )
        except Exception:
            res = (
                supabase.table("resumes")
                .insert({**base_record, "user_id": str(profile_id)})
                .execute()
            )

        if not res.data:
            raise RuntimeError("Database insert returned empty result.")
        inserted = res.data[0]
    except Exception as db_err:
        # 8. Clean up uploaded storage file if DB insert fails
        if upload_success:
            try:
                supabase.storage.from_(RESUMES_BUCKET).remove([storage_path])
            except Exception:
                pass
        raise AppException(
            message=f"Failed to save resume record in database: {str(db_err)}",
            code="DATABASE_INSERT_ERROR",
            status_code=500,
        )

    # 9. Return preview and char_count
    return {
        "id": inserted.get("id", resume_id),
        "original_filename": original_filename,
        "char_count": len(clean_text),
        "text_preview": clean_text[:300],
        "created_at": inserted.get("created_at", created_at),
    }


def get_resume_by_id(resume_id: str) -> Dict[str, Any]:
    res = supabase.table("resumes").select("*").eq("id", str(resume_id)).execute()
    if not res.data:
        raise NotFoundException(
            message=f"Resume with id '{resume_id}' does not exist.",
            code="RESUME_NOT_FOUND",
        )
    data = res.data[0]
    if "profile_id" not in data and "user_id" in data:
        data["profile_id"] = data["user_id"]
    return data


def get_resume_text(resume_id: str) -> str:
    """
    Exposed repository function that returns raw_text for a resume.
    This is the single integration point for Leo's pipeline.
    """
    resume = get_resume_by_id(resume_id)
    return resume.get("raw_text", "")


def get_resume_by_profile_id(profile_id: str) -> Dict[str, Any]:
    """
    Retrieve candidate's active resume.
    Returns 404 with code 'profile_not_found' if profile doesn't exist.
    Returns 404 with code 'resume_not_found' if no resume has been uploaded yet.
    """
    # 1. Verify profile exists
    try:
        get_profile_by_id(profile_id)
    except NotFoundException:
        raise NotFoundException(
            message=f"Profile '{profile_id}' not found.",
            code="profile_not_found",
        )

    # 2. Select profile's resume. The table may name the owner column
    # profile_id or user_id; querying a missing column raises, so fall back.
    try:
        res = (
            supabase.table("resumes")
            .select("*")
            .eq("profile_id", str(profile_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        res = None
    if not res or not res.data:
        # Fallback check on user_id column
        res = (
            supabase.table("resumes")
            .select("*")
            .eq("user_id", str(profile_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

    if not res.data:
        raise NotFoundException(
            message="Candidate has not uploaded a resume yet.",
            code="resume_not_found",
        )

    resume = res.data[0]
    raw_text = resume.get("raw_text") or ""
    return {
        "id": resume["id"],
        "original_filename": resume.get("original_filename", "resume.pdf"),
        "char_count": len(raw_text),
        "created_at": resume.get("created_at"),
        "updated_at": resume.get("updated_at") or resume.get("created_at"),
    }


def delete_resume_by_profile_id(profile_id: str) -> None:
    """
    Delete candidate's stored resume from Storage and database.
    Rejects with 409 if candidate has any session currently processing.
    """
    # 1. Verify profile and resume exist
    resume_info = get_resume_by_profile_id(profile_id)
    resume_id = resume_info["id"]

    # 2. Reject with 409 if any session is in 'processing' status
    proc_res = (
        supabase.table("interview_sessions")
        .select("id")
        .eq("status", "processing")
        .eq("resume_id", str(resume_id))
        .limit(1)
        .execute()
    )
    if proc_res.data and len(proc_res.data) > 0:
        raise ConflictException(
            message="Cannot delete resume while an interview session is processing.",
            code="SESSION_PROCESSING_CONFLICT",
        )

    # Fetch full resume record for storage path
    res = supabase.table("resumes").select("pdf_storage_path").eq("id", str(resume_id)).execute()
    pdf_path = res.data[0].get("pdf_storage_path") if res.data else f"resumes/{resume_id}.pdf"

    # 3. Delete from Storage first
    try:
        supabase.storage.from_(RESUMES_BUCKET).remove([pdf_path])
    except Exception as e:
        raise AppException(
            message=f"Failed to delete resume file from storage: {str(e)}",
            code="STORAGE_DELETE_ERROR",
            status_code=500,
        )

    # 4. Delete database row
    supabase.table("resumes").delete().eq("id", str(resume_id)).execute()
