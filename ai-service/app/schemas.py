from typing import List, Optional
from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    session_id: str
    question: str
    audio_url: str       # Public URL from audio
    resume_pdf_url: str  # Public URL from Supabase pdf
    job_description: str
    language: str = "en" # 'en' or 'es'
class MetricsResult(BaseModel):
    duration_seconds: float
    speech_rate_wpm: int
    filler_count: int
    long_pause_count: int
    repetitions_count: int

class FeedbackItem(BaseModel):
    criterion: str
    observation: str
    improvement: str

class AnalyzeResponse(BaseModel):
    session_id: str
    metrics: MetricsResult
    transcript_text: str
    feedback: List[FeedbackItem]

class HealthResponse(BaseModel):
    status: str
    environment: str