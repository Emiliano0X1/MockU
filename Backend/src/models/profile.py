from datetime import datetime
from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field

ExperienceLevel = Literal["intern", "new_grad"]


class ProfileCreate(BaseModel):
    full_name: str = Field(..., min_length=1, description="Candidate's full name")
    experience_level: ExperienceLevel = Field(
        ..., description="Must be 'intern' or 'new_grad'"
    )


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1)
    experience_level: Optional[ExperienceLevel] = None


class ProfileResponse(BaseModel):
    id: UUID
    full_name: str
    experience_level: str
    created_at: datetime
    updated_at: Optional[datetime] = None
