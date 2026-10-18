from typing import Any, Dict, List
from src.core.config import supabase
from src.core.exceptions import NotFoundException


def list_companies() -> List[Dict[str, Any]]:
    res = supabase.table("companies").select("*").order("name").execute()
    return res.data or []


def get_company_by_id(company_id: str) -> Dict[str, Any]:
    res = supabase.table("companies").select("*").eq("id", str(company_id)).execute()
    if not res.data:
        raise NotFoundException(
            message=f"Company with id '{company_id}' does not exist.",
            code="COMPANY_NOT_FOUND",
        )
    return res.data[0]
