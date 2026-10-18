import statistics
from typing import Any, Dict, List, Optional
from src.core.config import supabase
from src.core.live_config import detector_config
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


def get_biometric_series(
    session_id: str,
    max_points: int = 300,
    from_ms: Optional[int] = None,
    to_ms: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Retrieve biometric series for frontend dashboard charts.
    Reduces data points to max_points using bucketing (preserving bpm_max).
    Calculates summary stats and baseline BPM (median of the warm-up window).
    """
    # 1. Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    # Validate window
    if from_ms is not None and from_ms < 0:
        raise UnprocessableEntityException("from_ms must be greater than or equal to 0.")
    if from_ms is not None and to_ms is not None and to_ms < from_ms:
        raise UnprocessableEntityException("to_ms must be greater than or equal to from_ms.")

    # 2. Select samples in requested window ordered by t_ms
    query = (
        supabase.table("biometric_samples")
        .select("t_ms, bpm")
        .eq("session_id", str(session_id))
    )
    if from_ms is not None:
        query = query.gte("t_ms", from_ms)
    if to_ms is not None:
        query = query.lte("t_ms", to_ms)

    res = query.order("t_ms").execute()
    samples = res.data or []

    if not samples:
        return {
            "session_id": session_id,
            "stats": {
                "count": 0,
                "min_bpm": None,
                "max_bpm": None,
                "avg_bpm": None,
                "baseline_bpm": None,
            },
            "points": [],
        }

    # Extract metrics
    bpms = [s["bpm"] for s in samples]
    count = len(samples)
    min_bpm = min(bpms)
    max_bpm = max(bpms)
    avg_bpm = round(sum(bpms) / count, 1)

    # Baseline rule: median of the live detector's warm-up window, so the
    # chart's resting line matches the baseline the live tips used.
    baseline_samples = [s["bpm"] for s in samples if s["t_ms"] <= detector_config.WARMUP_MS]
    baseline_bpm = (
        int(round(statistics.median(baseline_samples)))
        if len(baseline_samples) >= 3
        else None
    )

    # 3. Bucketing logic
    capped_max_points = min(max(1, max_points), 1000)
    if count <= capped_max_points:
        points = [
            {
                "t_ms": s["t_ms"],
                "bpm_avg": float(s["bpm"]),
                "bpm_max": s["bpm"],
            }
            for s in samples
        ]
    else:
        min_t = samples[0]["t_ms"]
        max_t = samples[-1]["t_ms"]
        bucket_duration = (max_t - min_t) / capped_max_points if max_t > min_t else 1

        buckets: Dict[int, List[int]] = {}
        bucket_first_t: Dict[int, int] = {}

        for s in samples:
            b_idx = int((s["t_ms"] - min_t) / bucket_duration)
            if b_idx >= capped_max_points:
                b_idx = capped_max_points - 1
            if b_idx not in buckets:
                buckets[b_idx] = []
                bucket_first_t[b_idx] = s["t_ms"]
            buckets[b_idx].append(s["bpm"])

        points = []
        for b_idx in sorted(buckets.keys()):
            b_bpms = buckets[b_idx]
            points.append(
                {
                    "t_ms": bucket_first_t[b_idx],
                    "bpm_avg": round(sum(b_bpms) / len(b_bpms), 1),
                    "bpm_max": max(b_bpms),
                }
            )

    return {
        "session_id": session_id,
        "stats": {
            "count": count,
            "min_bpm": min_bpm,
            "max_bpm": max_bpm,
            "avg_bpm": avg_bpm,
            "baseline_bpm": baseline_bpm,
        },
        "points": points,
    }
