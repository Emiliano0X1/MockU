from typing import Any, Dict, Optional
from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppException(Exception):
    """Base application exception with custom status code and error details."""

    def __init__(
        self,
        message: str,
        code: str = "BAD_REQUEST",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class NotFoundException(AppException):
    def __init__(self, message: str = "Resource not found", code: str = "NOT_FOUND"):
        super().__init__(message=message, code=code, status_code=status.HTTP_404_NOT_FOUND)


class ConflictException(AppException):
    def __init__(self, message: str = "Conflict in resource state", code: str = "CONFLICT"):
        super().__init__(message=message, code=code, status_code=status.HTTP_409_CONFLICT)


class BadRequestException(AppException):
    def __init__(self, message: str = "Bad request", code: str = "BAD_REQUEST"):
        super().__init__(message=message, code=code, status_code=status.HTTP_400_BAD_REQUEST)


class PayloadTooLargeException(AppException):
    def __init__(self, message: str = "Payload too large", code: str = "PAYLOAD_TOO_LARGE"):
        super().__init__(
            message=message,
            code=code,
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )


class UnprocessableEntityException(AppException):
    def __init__(self, message: str = "Validation failed", code: str = "UNPROCESSABLE_ENTITY"):
        super().__init__(
            message=message,
            code=code,
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


def format_error_response(code: str, message: str, status_code: int) -> JSONResponse:
    """Formats error responses according to the global convention:
    { "error": { "code": "...", "message": "..." } }
    """
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    return format_error_response(
        code=exc.code,
        message=exc.message,
        status_code=exc.status_code,
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Build a clean readable validation message
    errors = exc.errors()
    first_error = errors[0] if errors else {}
    msg = first_error.get("msg", "Validation error")
    loc = " -> ".join([str(x) for x in first_error.get("loc", []) if x != "body"])
    message = f"{loc}: {msg}" if loc else msg

    return format_error_response(
        code="VALIDATION_ERROR",
        message=message,
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    )
