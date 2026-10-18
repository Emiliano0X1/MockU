from typing import List
from pydantic import BaseModel, Field


class BiometricSample(BaseModel):
    t_ms: int = Field(..., ge=0, description="Milliseconds since session started_at")
    bpm: int = Field(..., ge=20, le=260, description="Heart rate in beats per minute (20-260)")


class BiometricBatchRequest(BaseModel):
    samples: List[BiometricSample] = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Batch of biometric samples (max 500 per request)",
    )


class BiometricBatchResponse(BaseModel):
    inserted: int
