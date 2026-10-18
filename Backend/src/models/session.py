from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field

SessionStatus = Literal["recording", "processing", "done", "failed"]


class SessionCreate(BaseModel):
    profile_id: UUID
    company_id: UUID
    resume_id: UUID
    role_title: Optional[str] = "SWE Intern"
    question_count: Optional[int] = Field(6, ge=1, le=10)


class SessionQuestionItem(BaseModel):
    position: int
    question_id: UUID
    text: str
    category: str
    asked_at_ms: Optional[int] = None


class SessionCreateResponse(BaseModel):
    id: UUID
    status: Literal["recording"] = "recording"
    started_at: datetime
    company_id: UUID
    resume_id: UUID
    role_title: str
    questions: List[SessionQuestionItem]


class SessionDetailResponse(BaseModel):
    id: UUID
    status: str
    company_id: UUID
    resume_id: UUID
    role_title: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    has_audio: bool
    report_ready: bool
    questions: List[SessionQuestionItem]


class QuestionShowRequest(BaseModel):
    asked_at_ms: int = Field(..., ge=0, description="Milliseconds since session started_at")


class QuestionShowResponse(BaseModel):
    position: int
    asked_at_ms: int


class SessionEndResponse(BaseModel):
    id: UUID
    status: str
    ended_at: datetime
    duration_ms: int


class SessionCompanyInfo(BaseModel):
    id: UUID
    name: str


class SessionListItem(BaseModel):
    id: UUID
    company: SessionCompanyInfo
    role_title: Optional[str] = None
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    overall_score: Optional[int] = None


class SessionListResponse(BaseModel):
    items: List[SessionListItem]
    total: int


class SessionReprocessResponse(BaseModel):
    session_id: UUID
    status: Literal["processing"] = "processing"
