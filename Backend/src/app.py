from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from src.core.exceptions import (
    AppException,
    app_exception_handler,
    format_error_response,
    validation_exception_handler,
)
from src.routes.router import api_v1_router

app = FastAPI(
    title="MockU AI Interview Coach API",
    description="Backend API for AI Interview Coach (AI LA Hackathon 2026)",
    version="0.1.0",
)

# 1. Enable CORS for frontend dashboard and wearable device
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Register Global Exception Handlers for strict error shape { "error": { "code", "message" } }
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return format_error_response(
        code="HTTP_ERROR",
        message=str(exc.detail),
        status_code=exc.status_code,
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    return format_error_response(
        code="INTERNAL_SERVER_ERROR",
        message="An unexpected internal server error occurred.",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )


# 3. Health check
@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "ok", "service": "MockU Backend"}


# 4. Include v1 endpoints (/api/v1)
app.include_router(api_v1_router)

if __name__ == "__main__":
    uvicorn.run("src.app:app", host="0.0.0.0", port=8000, reload=True)
