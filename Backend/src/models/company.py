from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel


class CompanyValue(BaseModel):
    name: str
    description: str


class CompanyResponse(BaseModel):
    id: UUID
    name: str
    industry: Optional[str] = None
    culture_summary: Optional[str] = None
    values: List[CompanyValue] = []
    website_url: Optional[str] = None
