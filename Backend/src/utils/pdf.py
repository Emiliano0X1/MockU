import io
import re
from typing import Tuple

# pyrefly: ignore[missing-import]
from pypdf import PdfReader

from src.core.exceptions import (
    BadRequestException,
    PayloadTooLargeException,
    UnprocessableEntityException,
)

MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


def validate_pdf_bytes(content: bytes, filename: str) -> None:
    """Validates that the file is not empty, does not exceed 5MB, and begins with %PDF."""
    if len(content) > MAX_PDF_SIZE_BYTES:
        raise PayloadTooLargeException(
            message=f"File exceeds maximum allowed size of 5 MB ({len(content)} bytes).",
            code="FILE_TOO_LARGE",
        )
    if not content.startswith(b"%PDF"):
        raise BadRequestException(
            message="Invalid file format. File must be a valid PDF starting with '%PDF'.",
            code="INVALID_PDF",
        )


def clean_resume_text(text: str) -> str:
    """
    Cleans extracted resume text to be RAG and prompt friendly:
    - Joins hyphenated line breaks (e.g. 'imple-\\nmentation' -> 'implementation')
    - Normalizes bullet points to standard '-'
    - Strips page number markers (e.g. 'Page 1 of 2')
    - Collapses repeated whitespace and excessive blank lines
    """
    if not text:
        return ""

    # Normalize carriage returns
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")

    # Join hyphenated line breaks
    cleaned = re.sub(r"(\w+)-\n(\w+)", r"\1\2", cleaned)

    # Normalize bullet characters
    cleaned = re.sub(r"[\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25BA\u25CF]", "-", cleaned)

    # Remove common page number indicators
    cleaned = re.sub(r"(?i)page\s+\d+(\s+of\s+\d+)?", "", cleaned)

    # Replace tabs and multiple horizontal whitespace with a single space
    cleaned = re.sub(r"[ \t]+", " ", cleaned)

    # Collapse multiple consecutive newlines (more than 2) into 2 newlines
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)

    # Trim leading/trailing whitespace
    return cleaned.strip()


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """
    Extracts raw text from PDF bytes using pypdf.
    Raises UnprocessableEntityException if the text is empty or too short (scanned PDF).
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages_text = [
            page.extract_text()
            for page in reader.pages
            if page.extract_text()
        ]
        extracted_text = "\n".join(pages_text)
    except Exception:
        extracted_text = ""

    cleaned = clean_resume_text(extracted_text)

    # Minimum length requirement (e.g. 30 chars) to ensure it is not an un-OCR'd scan
    if len(cleaned) < 30:
        raise UnprocessableEntityException(
            message="No extractable text. The PDF may be a scan.",
            code="NO_EXTRACTABLE_TEXT",
        )

    return cleaned
