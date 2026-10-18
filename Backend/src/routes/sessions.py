from typing import Optional
from uuid import UUID
from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    Query,
    Response,
    UploadFile,
    status,
)
from src.core.exceptions import ConflictException
from src.core.live_config import PULSOID_ENABLED
from src.models.audio import AudioUploadResponse
from src.models.biometric import (
    BiometricBatchRequest,
    BiometricBatchResponse,
    BiometricSeriesResponse,
)
from src.models.report import ReportResponse
from src.models.session import (
    QuestionShowRequest,
    QuestionShowResponse,
    SessionCreate,
    SessionCreateResponse,
    SessionDetailResponse,
    SessionEndResponse,
    SessionListResponse,
    SessionReprocessResponse,
)
from src.models.transcript import TranscriptResponse
from src.services.audio_service import (
    run_post_interview_pipeline,
    upload_audio_and_start_processing,
)
from src.services.biometric_service import (
    get_biometric_series,
    ingest_biometrics_batch,
)
from src.services.live_manager import live_manager
from src.services.pulsoid_service import start_pulsoid_for_session
from src.services.report_service import get_session_report
from src.services.session_service import (
    create_session,
    delete_session,
    end_session,
    get_session_by_id,
    list_sessions,
    record_question_shown,
    reprocess_session,
)
from src.services.transcript_service import get_session_transcript

router = APIRouter(prefix="/sessions", tags=["Interview Sessions"])


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
def handle_create_session(payload: SessionCreate):
    """Start a new mock interview session and select randomized questions."""
    # Enforce one active Pulsoid session at a time if live streaming is enabled
    if PULSOID_ENABLED:
        for s_id, s in live_manager.active_sessions.items():
            if s.pulsoid_task and not s.pulsoid_task.done():
                raise ConflictException(
                    message="Another interview is in progress.",
                    code="SESSION_IN_PROGRESS",
                )

    result = create_session(
        profile_id=str(payload.profile_id),
        company_id=str(payload.company_id),
        resume_id=str(payload.resume_id),
        role_title=payload.role_title or "SWE Intern",
        question_count=payload.question_count or 6,
    )

    # Initialize live tracking session
    session_id = str(result["id"])
    live_manager.get_or_create_session(session_id, result["started_at"])

    # Launch Pulsoid listener if enabled
    if PULSOID_ENABLED:
        try:
            start_pulsoid_for_session(session_id)
        except Exception:
            pass

    return result


@router.get("", response_model=SessionListResponse, status_code=status.HTTP_200_OK)
def handle_list_sessions(
    profile_id: UUID = Query(..., description="Candidate profile ID"),
    status: Optional[str] = Query(None, description="Optional status filter"),
    limit: int = Query(20, ge=1, le=50, description="Page limit (max 50)"),
    offset: int = Query(0, ge=0, description="Page offset"),
):
    """Retrieve paginated list of candidate interview sessions."""
    return list_sessions(
        profile_id=str(profile_id),
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/{id}", response_model=SessionDetailResponse, status_code=status.HTTP_200_OK)
def handle_get_session(id: UUID):
    """Retrieve session state, question timeline, and processing flags."""
    return get_session_by_id(str(id))


@router.patch(
    "/{id}/questions/{position}",
    response_model=QuestionShowResponse,
    status_code=status.HTTP_200_OK,
)
def handle_record_question_shown(
    id: UUID,
    position: int,
    payload: QuestionShowRequest,
):
    """Record the timestamp (ms since started_at) when a question was displayed."""
    return record_question_shown(
        session_id=str(id),
        position=position,
        asked_at_ms=payload.asked_at_ms,
    )


@router.post(
    "/{id}/biometrics",
    response_model=BiometricBatchResponse,
    status_code=status.HTTP_201_CREATED,
)
async def handle_ingest_biometrics(id: UUID, payload: BiometricBatchRequest):
    """
    Batch ingest biometric heart rate samples from wearable or simulator.
    Feeds samples into the live spike detector for real-time glasses feedback.
    """
    session_id = str(id)

    # Reject manual ingestion if an automated Pulsoid sensor is already streaming
    sess = live_manager.get_session(session_id)
    if PULSOID_ENABLED and sess and sess.pulsoid_task and not sess.pulsoid_task.done():
        raise ConflictException(
            message="Live sensor active. Manual ingestion is disabled while Pulsoid is streaming.",
            code="LIVE_SENSOR_ACTIVE",
        )

    raw_samples = [s.model_dump() for s in payload.samples]
    inserted_count = ingest_biometrics_batch(session_id, raw_samples)

    # Feed samples into the real-time detector
    for s in payload.samples:
        await live_manager.ingest_sample(
            session_id=session_id,
            bpm=s.bpm,
            explicit_t_ms=s.t_ms,
        )

    return {"inserted": inserted_count}


@router.get(
    "/{id}/biometrics",
    response_model=BiometricSeriesResponse,
    status_code=status.HTTP_200_OK,
)
def handle_get_biometrics_series(
    id: UUID,
    max_points: int = Query(300, ge=1, le=1000, description="Max points to return for chart"),
    from_ms: Optional[int] = Query(None, ge=0, description="Window start time in ms"),
    to_ms: Optional[int] = Query(None, ge=0, description="Window end time in ms"),
):
    """Retrieve bucketed biometric data points and metrics for dashboard charts."""
    return get_biometric_series(
        session_id=str(id),
        max_points=max_points,
        from_ms=from_ms,
        to_ms=to_ms,
    )


@router.post("/{id}/end", response_model=SessionEndResponse, status_code=status.HTTP_200_OK)
async def handle_end_session(id: UUID):
    """Mark the interview as completed, stop live tracking, and close glasses connection."""
    session_id = str(id)
    res = end_session(session_id)

    # Stop live session manager, flush buffer, and notify glasses
    await live_manager.end_session(session_id)

    return res


@router.post(
    "/{id}/audio",
    response_model=AudioUploadResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def handle_upload_audio(
    id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    duration_ms: Optional[int] = Form(None),
):
    """Upload recorded audio and trigger background post-interview processing pipeline."""
    file_bytes = await file.read()
    result = upload_audio_and_start_processing(
        session_id=str(id),
        file_bytes=file_bytes,
        original_filename=file.filename or "recording.webm",
        duration_ms=duration_ms,
    )

    # Dispatch background analysis pipeline
    background_tasks.add_task(run_post_interview_pipeline, str(id))

    return result


@router.post(
    "/{id}/reprocess",
    response_model=SessionReprocessResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def handle_reprocess_session(
    id: UUID,
    background_tasks: BackgroundTasks,
):
    """Re-run the analysis for a finished interview session, replacing previous derived results."""
    result = reprocess_session(str(id))
    background_tasks.add_task(run_post_interview_pipeline, str(id))
    return result


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def handle_delete_session(id: UUID):
    """Delete an interview session, related records, and audio recording from storage."""
    session_id = str(id)
    await live_manager.end_session(session_id)
    delete_session(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{id}/report", response_model=ReportResponse, status_code=status.HTTP_200_OK)
def handle_get_report(id: UUID):
    """Deliver final evaluation report and timeline findings."""
    return get_session_report(str(id))


@router.get(
    "/{id}/transcript",
    response_model=TranscriptResponse,
    status_code=status.HTTP_200_OK,
)
def handle_get_transcript(id: UUID):
    """Provide timestamped transcript segments for findings alignment."""
    return get_session_transcript(str(id))
