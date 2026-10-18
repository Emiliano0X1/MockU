from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4
from src.core.config import supabase
from src.core.exceptions import NotFoundException, UnprocessableEntityException


def create_profile(full_name: str, experience_level: str) -> Dict[str, Any]:
    if experience_level not in ["intern", "new_grad"]:
        raise UnprocessableEntityException(
            message="Invalid experience_level. Allowed values are 'intern' or 'new_grad'.",
            code="INVALID_EXPERIENCE_LEVEL",
        )

    profile_data = {
        "id": str(uuid4()),
        "full_name": full_name,
        "experience_level": experience_level,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    res = supabase.table("profiles").insert(profile_data).execute()
    if not res.data:
        raise RuntimeError("Failed to insert profile record into database.")
    return res.data[0]


def get_profile_by_id(profile_id: str) -> Dict[str, Any]:
    res = supabase.table("profiles").select("*").eq("id", str(profile_id)).execute()
    if not res.data:
        raise NotFoundException(
            message=f"Profile with id '{profile_id}' does not exist.",
            code="PROFILE_NOT_FOUND",
        )
    return res.data[0]


def update_profile(
    profile_id: str,
    full_name: Optional[str] = None,
    experience_level: Optional[str] = None,
) -> Dict[str, Any]:
    # Ensure profile exists
    get_profile_by_id(profile_id)

    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if full_name is not None:
        updates["full_name"] = full_name
    if experience_level is not None:
        if experience_level not in ["intern", "new_grad"]:
            raise UnprocessableEntityException(
                message="Invalid experience_level. Allowed values are 'intern' or 'new_grad'.",
                code="INVALID_EXPERIENCE_LEVEL",
            )
        updates["experience_level"] = experience_level

    res = (
        supabase.table("profiles")
        .update(updates)
        .eq("id", str(profile_id))
        .execute()
    )
    if not res.data:
        raise RuntimeError(f"Failed to update profile '{profile_id}'.")
    return res.data[0]
