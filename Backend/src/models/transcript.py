from typing import List
from uuid import UUID
from pydantic import BaseModel


class TranscriptSegment(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class TranscriptResponse(BaseModel):
    session_id: UUID
    status: str
    segments: List[TranscriptSegment] = []
