from fastapi import APIRouter
from src.routes.companies import router as companies_router
from src.routes.profiles import router as profiles_router
from src.routes.resumes import router as resumes_router
from src.routes.sessions import router as sessions_router

api_v1_router = APIRouter(prefix="/api/v1")

api_v1_router.include_router(profiles_router)
api_v1_router.include_router(companies_router)
api_v1_router.include_router(resumes_router)
api_v1_router.include_router(sessions_router)
