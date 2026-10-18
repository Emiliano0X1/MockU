from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class ResumeUploadResponse(BaseModel):
    id: UUID
    original_filename: str
    char_count: int
    text_preview: str
    created_at: datetime
