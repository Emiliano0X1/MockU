from uuid import UUID
from fastapi import APIRouter, File, Form, UploadFile, status
from src.models.resume import ResumeUploadResponse
from src.services.resume_service import upload_and_parse_resume

router = APIRouter(prefix="/resumes", tags=["Resumes"])


@router.post("", response_model=ResumeUploadResponse, status_code=status.HTTP_201_CREATED)
async def handle_upload_resume(
    file: UploadFile = File(...),
    profile_id: UUID = Form(...),
):
    """
    Upload and parse candidate PDF resume.
    Stores original PDF in storage and saves clean raw_text for AI analysis.
    """
    content = await file.read()
    return upload_and_parse_resume(
        file_bytes=content,
        original_filename=file.filename or "resume.pdf",
        profile_id=str(profile_id),
    )
