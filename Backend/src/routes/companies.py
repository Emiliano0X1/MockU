from typing import List
from fastapi import APIRouter, status
from src.models.company import CompanyResponse
from src.services.company_service import list_companies

router = APIRouter(prefix="/companies", tags=["Companies"])


@router.get("", response_model=List[CompanyResponse], status_code=status.HTTP_200_OK)
def handle_list_companies():
    """Retrieve catalog of mock companies ordered by name."""
    return list_companies()
