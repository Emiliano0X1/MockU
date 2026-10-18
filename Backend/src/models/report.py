from typing import Any, Dict, List, Literal, Optional
from uuid import UUID
from pydantic import BaseModel

FindingSeverity = Literal["low", "medium", "high"]


class ReportFinding(BaseModel):
    id: UUID
    category: str
    start_ms: int
    end_ms: int
    severity: FindingSeverity
    title: str
    details: Dict[str, Any] = {}


class ReportData(BaseModel):
    overall_score: Optional[int] = None
    schema_version: str = "1.0.0"
    summary: Dict[str, Any] = {}
    findings: List[ReportFinding] = []


class ReportResponse(BaseModel):
    session_id: UUID
    status: str
    report: Optional[ReportData] = None
