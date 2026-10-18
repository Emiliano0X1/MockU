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

# --- Whole-interview analysis (one audio file for the whole session) ---

class InterviewQuestion(BaseModel):
    position: int
    text: str
    asked_at_ms: Optional[int] = None  # when it appeared, ms from the start of the audio

class HeartRateEvent(BaseModel):
    t_ms: int
    bpm_at_trigger: Optional[int] = None
    baseline_bpm: Optional[int] = None
    text: Optional[str] = None

class AnalyzeInterviewRequest(BaseModel):
    session_id: str
    audio_url: str                        # e.g. a signed Supabase storage URL
    questions: List[InterviewQuestion]
    resume_text: str = ""                 # preferred: the backend already extracted it
    resume_pdf_url: Optional[str] = None  # used only when resume_text is empty
    job_description: str = ""
    language: str = "en"
    heart_rate_events: List[HeartRateEvent] = []

class TimedFinding(BaseModel):
    category: str      # pauses | fillers | restarts | <feedback criterion>
    start_ms: int
    end_ms: int
    severity: str      # low | medium | high
    title: str
    details: dict = {}

class TranscriptSegmentOut(BaseModel):
    start_ms: int
    end_ms: int
    text: str

class InterviewSummaryOut(BaseModel):
    overall_score: int
    communication_score: int
    technical_depth_score: int
    composure_score: int
    overview: str
    key_strengths: List[str]
    areas_for_growth: List[str]

class AnalyzeInterviewResponse(BaseModel):
    session_id: str
    transcript_text: str
    segments: List[TranscriptSegmentOut]
    metrics: MetricsResult
    findings: List[TimedFinding]
    summary: InterviewSummaryOut

class HealthResponse(BaseModel):
    status: str
    environment: str