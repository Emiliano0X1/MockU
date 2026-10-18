from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field

SeverityLevel = Literal["low", "medium", "high"]


class SuggestionItem(BaseModel):
    id: UUID
    t_ms: int
    text: str
    severity: SeverityLevel
    trigger_reason: str
    bpm_at_trigger: Optional[int] = None
    baseline_bpm: Optional[int] = None
    delivered_at: Optional[datetime] = None


class SuggestionListResponse(BaseModel):
    session_id: UUID
    items: List[SuggestionItem] = []


class TestSuggestionRequest(BaseModel):
    text: Optional[str] = Field("Test: take a slow breath", description="Text to show on glasses")
    severity: Optional[SeverityLevel] = Field("medium", description="Severity level")


class TestSuggestionResponse(BaseModel):
    id: UUID
    delivered: bool
