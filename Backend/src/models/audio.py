from typing import Literal
from uuid import UUID
from pydantic import BaseModel


class AudioUploadResponse(BaseModel):
    session_id: UUID
    status: Literal["processing"] = "processing"
