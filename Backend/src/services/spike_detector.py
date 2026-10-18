import logging
import statistics
from typing import Any, Dict, List, Optional, Tuple
from src.core.live_config import detector_config

logger = logging.getLogger("mocku.live")


def _skip(t_ms: int, bpm: int, reason: str) -> None:
    """Logs why a reading did not produce a suggestion, and returns None."""
    logger.info("  t=%5.1fs bpm=%3d -> no tip: %s", t_ms / 1000, bpm, reason)
    return None

MEDIUM_MESSAGES = [
    "Take a slow breath",
    "Pause, then answer",
    "Slow down your pace",
]

HIGH_MESSAGES = [
    "Breathe. Take your time",
    "Pause and breathe slowly",
    "Slow down. You are doing fine",
]


class DetectorState:
    """In-memory state tracked for an ongoing interview session."""

    def __init__(self):
        self.baseline_bpm: Optional[int] = None
        self.warmup_samples: List[int] = []
        self.recent_samples: List[Tuple[int, int]] = []  # [(t_ms, bpm), ...]
        self.last_suggestion_t_ms: Optional[int] = None
        self.suggestion_count: int = 0
        self.is_armed: bool = True
        self.last_message_text: Optional[str] = None


def select_message(severity: str, last_message: Optional[str]) -> str:
    """Select a template message ensuring no immediate repetition."""
    templates = HIGH_MESSAGES if severity == "high" else MEDIUM_MESSAGES
    for msg in templates:
        if msg != last_message:
            return msg
    return templates[0]


def evaluate_sample(
    t_ms: int,
    bpm: int,
    state: DetectorState,
    has_glasses_connected: bool,
    is_stale: bool,
) -> Optional[Dict[str, Any]]:
    """
    Pure evaluation function executed for every incoming biometric sample.
    Returns suggestion payload if a sustained spike triggers, otherwise None.
    """
    # Maintain rolling sample buffer (up to last 30 seconds for spike & re-arm checks)
    state.recent_samples.append((t_ms, bpm))
    cutoff = t_ms - 30000
    state.recent_samples = [s for s in state.recent_samples if s[0] >= cutoff]

    # 1. WARM-UP & BASELINE EVALUATION
    if t_ms < detector_config.WARMUP_MS:
        state.warmup_samples.append(bpm)
        return _skip(t_ms, bpm, f"warm-up ({t_ms // 1000}s of {detector_config.WARMUP_MS // 1000}s, {len(state.warmup_samples)} samples)")

    # Compute baseline once warm-up period completes
    if state.baseline_bpm is None:
        if len(state.warmup_samples) >= detector_config.BASELINE_MIN_SAMPLES:
            state.baseline_bpm = int(round(statistics.median(state.warmup_samples)))
            logger.info("  baseline set: %d bpm from %d warm-up samples", state.baseline_bpm, len(state.warmup_samples))
        else:
            # Continue collecting samples until enough exist
            state.warmup_samples.append(bpm)
            return _skip(t_ms, bpm, f"collecting baseline ({len(state.warmup_samples)}/{detector_config.BASELINE_MIN_SAMPLES} samples)")

    baseline = state.baseline_bpm

    # Check re-arm condition: pulse must fall below baseline + REARM_DELTA
    if not state.is_armed:
        if bpm < (baseline + detector_config.REARM_DELTA):
            state.is_armed = True
            logger.info("  re-armed: %d bpm is below baseline %d + %d", bpm, baseline, detector_config.REARM_DELTA)
        else:
            # Still disarmed from previous spike
            return _skip(t_ms, bpm, f"disarmed until below {baseline + detector_config.REARM_DELTA} bpm")

    # 2. No glasses connected: skip generating suggestions
    if not has_glasses_connected:
        return _skip(t_ms, bpm, "no glasses connected to the live socket")

    # 3. Sensor stale: detector pauses
    if is_stale:
        return _skip(t_ms, bpm, "sensor stale")

    # 8. CAP: maximum suggestions reached
    if state.suggestion_count >= detector_config.MAX_SUGGESTIONS:
        return _skip(t_ms, bpm, f"cap reached ({detector_config.MAX_SUGGESTIONS} tips)")

    # 6. COOLDOWN: skip if within cooldown gap
    if state.last_suggestion_t_ms is not None:
        if (t_ms - state.last_suggestion_t_ms) < detector_config.COOLDOWN_MS:
            return _skip(t_ms, bpm, f"cooldown ({(t_ms - state.last_suggestion_t_ms) // 1000}s of {detector_config.COOLDOWN_MS // 1000}s)")

    # 4. SUSTAINED SPIKE: check all samples in the last SUSTAIN_MS window
    sustain_cutoff = t_ms - detector_config.SUSTAIN_MS
    window_samples = [s for s in state.recent_samples if s[0] >= sustain_cutoff]

    # Require at least 2 samples covering at least 60% of the window duration
    if len(window_samples) < 2:
        return _skip(t_ms, bpm, f"need 2+ samples in the last {detector_config.SUSTAIN_MS // 1000}s (have {len(window_samples)})")

    window_span = window_samples[-1][0] - window_samples[0][0]
    if window_span < (detector_config.SUSTAIN_MS * 0.6):
        return _skip(t_ms, bpm, f"samples span {window_span // 1000}s, need {detector_config.SUSTAIN_MS * 0.6 / 1000:.0f}s")

    medium_threshold = baseline + detector_config.SPIKE_DELTA_MEDIUM
    # Every sample in the sustain window must be at or above medium threshold
    if not all(s[1] >= medium_threshold for s in window_samples):
        return _skip(t_ms, bpm, f"not a sustained spike (needs all >= {medium_threshold}, baseline {baseline})")

    # 5. SEVERITY: evaluate average BPM across the window
    window_avg = sum(s[1] for s in window_samples) / len(window_samples)
    high_threshold = baseline + detector_config.SPIKE_DELTA_HIGH

    if window_avg >= high_threshold:
        severity = "high"
        trigger_reason = "sustained_spike"
    else:
        severity = "medium"
        trigger_reason = "mild_spike"

    # Select non-repeating message
    text = select_message(severity, state.last_message_text)

    # 9. Update state
    state.last_suggestion_t_ms = t_ms
    state.last_message_text = text
    state.suggestion_count += 1
    state.is_armed = False  # Disarm until pulse drops below baseline + REARM_DELTA
    logger.info("  t=%5.1fs bpm=%3d -> TIP (%s): '%s' (window avg %.0f, baseline %d)", t_ms / 1000, bpm, severity, text, window_avg, baseline)

    return {
        "text": text,
        "severity": severity,
        "trigger_reason": trigger_reason,
        "bpm_at_trigger": bpm,
        "baseline_bpm": baseline,
        "t_ms": t_ms,
        "ttl_ms": detector_config.TTL_MS,
    }
