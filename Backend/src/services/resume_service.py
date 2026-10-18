from datetime import datetime, timezone
from typing import Any, Dict
from uuid import uuid4
from src.core.config import supabase
from src.core.exceptions import (
    AppException,
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

    # 3 & 4 & 5. Extract and clean text (throws 422 if empty / scanned)
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
    except Exception as e:
        # Some Supabase storage setups place the file directly at the root of bucket
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
    resume_record = {
        "id": resume_id,
        "user_id": str(profile_id),
        "pdf_storage_path": storage_path,
        "raw_text": clean_text,
        "original_filename": original_filename,
        "created_at": created_at,
    }

    try:
        res = supabase.table("resumes").insert(resume_record).execute()
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
    return res.data[0]


def get_resume_text(resume_id: str) -> str:
    """
    Exposed repository function that returns raw_text for a resume.
    This is the single integration point for Leo's pipeline.
    """
    resume = get_resume_by_id(resume_id)
    return resume.get("raw_text", "")
