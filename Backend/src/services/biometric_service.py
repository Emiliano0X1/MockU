from typing import Any, Dict, List
from src.core.config import supabase
from src.core.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
    PayloadTooLargeException,
    UnprocessableEntityException,
)


def ingest_biometrics_batch(
    session_id: str, samples: List[Dict[str, Any]]
) -> int:
    # 1. Verify batch size constraints
    if not samples:
        raise BadRequestException(
            message="Biometric batch cannot be empty.",
            code="EMPTY_BATCH",
        )
    if len(samples) > 500:
        raise PayloadTooLargeException(
            message=f"Batch size {len(samples)} exceeds maximum allowed limit of 500 samples.",
            code="BATCH_TOO_LARGE",
        )

    # 2. Verify session exists and is recording
    s_res = (
        supabase.table("interview_sessions")
        .select("status")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session_status = s_res.data[0].get("status")
    if session_status != "recording":
        raise ConflictException(
            message=f"Cannot ingest biometrics. Session status is '{session_status}', expected 'recording'.",
            code="SESSION_NOT_RECORDING",
        )

    # 3. Validate every sample
    rows_to_insert = []
    seen_timestamps = set()

    for idx, s in enumerate(samples):
        t_ms = s.get("t_ms")
        bpm = s.get("bpm")

        if t_ms is None or not isinstance(t_ms, int) or t_ms < 0:
            raise UnprocessableEntityException(
                message=f"Sample at index {idx} has invalid t_ms: {t_ms}. Must be integer >= 0.",
                code="INVALID_BIOMETRIC_SAMPLE",
            )

        if bpm is None or not isinstance(bpm, int) or bpm < 20 or bpm > 260:
            raise UnprocessableEntityException(
                message=f"Sample at index {idx} has invalid bpm: {bpm}. Must be integer between 20 and 260.",
                code="INVALID_BIOMETRIC_SAMPLE",
            )

        # In-memory deduplication for identical timestamps in the same batch
        if t_ms not in seen_timestamps:
            seen_timestamps.add(t_ms)
            rows_to_insert.append(
                {
                    "session_id": str(session_id),
                    "t_ms": t_ms,
                    "bpm": bpm,
                }
            )

    if not rows_to_insert:
        return 0

    # 4 & 5. Bulk insert/upsert to tolerate retries on (session_id, t_ms)
    try:
        res = (
            supabase.table("biometric_samples")
            .upsert(rows_to_insert, on_conflict="session_id,t_ms")
            .execute()
        )
        inserted_count = len(res.data) if res.data else len(rows_to_insert)
    except Exception:
        # Fallback to standard insert if upsert syntax differs
        res = supabase.table("biometric_samples").insert(rows_to_insert).execute()
        inserted_count = len(res.data) if res.data else len(rows_to_insert)

    return inserted_count
