from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel


class ResumeUploadResponse(BaseModel):
    id: UUID
    original_filename: str
    char_count: int
    text_preview: str
    created_at: datetime


class ProfileResumeResponse(BaseModel):
    id: UUID
    original_filename: str
    char_count: int
    created_at: datetime
    updated_at: Optional[datetime] = None
