from uuid import UUID
from fastapi import APIRouter, Response, status
from src.models.profile import ProfileCreate, ProfileResponse, ProfileUpdate
from src.models.resume import ProfileResumeResponse
from src.services.profile_service import (
    create_profile,
    get_profile_by_id,
    update_profile,
)
from src.services.resume_service import (
    delete_resume_by_profile_id,
    get_resume_by_profile_id,
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


@router.get(
    "/{profile_id}/resume",
    response_model=ProfileResumeResponse,
    status_code=status.HTTP_200_OK,
)
def handle_get_profile_resume(profile_id: UUID):
    """
    Retrieve metadata for the candidate's active resume.
    Returns 404 with code 'resume_not_found' if no resume has been uploaded.
    """
    return get_resume_by_profile_id(str(profile_id))


@router.delete(
    "/{profile_id}/resume",
    status_code=status.HTTP_204_NO_CONTENT,
)
def handle_delete_profile_resume(profile_id: UUID):
    """
    Delete the candidate's stored resume from storage and database.
    Rejects with 409 if candidate has any session currently processing.
    """
    delete_resume_by_profile_id(str(profile_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
