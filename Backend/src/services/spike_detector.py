import statistics
from typing import Any, Dict, List, Optional, Tuple
from src.core.live_config import detector_config

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
        return None

    # Compute baseline once warm-up period completes
    if state.baseline_bpm is None:
        if len(state.warmup_samples) >= detector_config.BASELINE_MIN_SAMPLES:
            state.baseline_bpm = int(round(statistics.median(state.warmup_samples)))
        else:
            # Continue collecting samples until enough exist
            state.warmup_samples.append(bpm)
            return None

    baseline = state.baseline_bpm

    # Check re-arm condition: pulse must fall below baseline + REARM_DELTA
    if not state.is_armed:
        if bpm < (baseline + detector_config.REARM_DELTA):
            state.is_armed = True
        else:
            # Still disarmed from previous spike
            return None

    # 2. No glasses connected: skip generating suggestions
    if not has_glasses_connected:
        return None

    # 3. Sensor stale: detector pauses
    if is_stale:
        return None

    # 8. CAP: maximum suggestions reached
    if state.suggestion_count >= detector_config.MAX_SUGGESTIONS:
        return None

    # 6. COOLDOWN: skip if within cooldown gap
    if state.last_suggestion_t_ms is not None:
        if (t_ms - state.last_suggestion_t_ms) < detector_config.COOLDOWN_MS:
            return None

    # 4. SUSTAINED SPIKE: check all samples in the last SUSTAIN_MS window
    sustain_cutoff = t_ms - detector_config.SUSTAIN_MS
    window_samples = [s for s in state.recent_samples if s[0] >= sustain_cutoff]

    # Require at least 2 samples covering at least 60% of the window duration
    if len(window_samples) < 2:
        return None

    window_span = window_samples[-1][0] - window_samples[0][0]
    if window_span < (detector_config.SUSTAIN_MS * 0.6):
        return None

    medium_threshold = baseline + detector_config.SPIKE_DELTA_MEDIUM
    # Every sample in the sustain window must be at or above medium threshold
    if not all(s[1] >= medium_threshold for s in window_samples):
        return None

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

    return {
        "text": text,
        "severity": severity,
        "trigger_reason": trigger_reason,
        "bpm_at_trigger": bpm,
        "baseline_bpm": baseline,
        "t_ms": t_ms,
        "ttl_ms": detector_config.TTL_MS,
    }
