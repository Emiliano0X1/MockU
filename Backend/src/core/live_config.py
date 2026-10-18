import os
from pydantic import BaseModel


class LiveDetectorConfig(BaseModel):
    # Time thresholds in milliseconds
    WARMUP_MS: int = 15000  # 15 seconds warm-up before any suggestion can trigger
    # Minimum samples for the baseline. The Apple Watch reports about every 5s,
    # so 15s of warm-up gives ~3 readings.
    BASELINE_MIN_SAMPLES: int = 3
    SPIKE_DELTA_MEDIUM: int = 15  # BPM above baseline for medium warning
    SPIKE_DELTA_HIGH: int = 30  # BPM above baseline for high warning
    SUSTAIN_MS: int = 8000  # Spike must hold continuously for 8 seconds
    COOLDOWN_MS: int = 45000  # Minimum gap between suggestions (45 seconds)
    REARM_DELTA: int = 8  # BPM must fall below baseline + 8 to re-arm detector
    MAX_SUGGESTIONS: int = 6  # Cap per interview session
    STALE_MS: int = 15000  # Sensor considered stale if no samples for 15s
    TTL_MS: int = 6000  # Display duration on glasses HUD (6 seconds)


# Live Mode global configuration
PULSOID_ACCESS_TOKEN: str = os.getenv("PULSOID_ACCESS_TOKEN", "")
PULSOID_ENABLED: bool = os.getenv("PULSOID_ENABLED", "false").lower() in ("true", "1", "yes")
LIVE_MAX_SESSION_MIN: int = int(os.getenv("LIVE_MAX_SESSION_MIN", "90"))

# Post-interview analysis server (ai-service/). Transcription plus several
# Gemini calls can take a few minutes for a full interview.
AI_SERVICE_URL: str = os.getenv("AI_SERVICE_URL", "http://127.0.0.1:8001").rstrip("/")
AI_SERVICE_TIMEOUT_S: float = float(os.getenv("AI_SERVICE_TIMEOUT_S", "600"))

detector_config = LiveDetectorConfig()
