from uuid import UUID
from fastapi import APIRouter, status
from src.models.profile import ProfileCreate, ProfileResponse, ProfileUpdate
from src.services.profile_service import (
    create_profile,
    get_profile_by_id,
    update_profile,
)

router = APIRouter(prefix="/profiles", tags=["Profiles"])


@router.post("", response_model=ProfileResponse, status_code=status.HTTP_201_CREATED)
def handle_create_profile(payload: ProfileCreate):
    """Create a new candidate profile."""
    return create_profile(
        full_name=payload.full_name,
        experience_level=payload.experience_level,
    )


@router.get("/{id}", response_model=ProfileResponse, status_code=status.HTTP_200_OK)
def handle_get_profile(id: UUID):
    """Retrieve an existing candidate profile by ID."""
    return get_profile_by_id(str(id))


@router.patch("/{id}", response_model=ProfileResponse, status_code=status.HTTP_200_OK)
def handle_update_profile(id: UUID, payload: ProfileUpdate):
    """Update fields of an existing candidate profile."""
    return update_profile(
        profile_id=str(id),
        full_name=payload.full_name,
        experience_level=payload.experience_level,
    )
