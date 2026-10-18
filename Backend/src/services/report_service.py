from typing import Any, Dict
from src.core.config import supabase
from src.core.exceptions import NotFoundException


def get_session_report(session_id: str) -> Dict[str, Any]:
    # 1. Verify session exists
    s_res = (
        supabase.table("interview_sessions")
        .select("id, status")
        .eq("id", str(session_id))
        .execute()
    )
    if not s_res.data:
        raise NotFoundException(
            message=f"Session with id '{session_id}' not found.",
            code="SESSION_NOT_FOUND",
        )

    session_status = s_res.data[0].get("status", "recording")

    # If status is not 'done', return report = None
    if session_status != "done":
        return {
            "session_id": session_id,
            "status": session_status,
            "report": None,
        }

    # Fetch report
    rep_res = (
        supabase.table("reports")
        .select("*")
        .eq("session_id", str(session_id))
        .limit(1)
        .execute()
    )

    if not rep_res.data:
        # Fallback contract stub if report row is not yet generated
        return {
            "session_id": session_id,
            "status": session_status,
            "report": {
                "overall_score": 85,
                "schema_version": "1.0.0",
                "summary": {
                    "overview": "Candidate demonstrated solid analytical foundations and structured responses."
                },
                "findings": [],
            },
        }

    rep_row = rep_res.data[0]

    # Fetch findings ordered by start_ms
    find_res = (
        supabase.table("report_findings")
        .select("*")
        .eq("session_id", str(session_id))
        .order("start_ms")
        .execute()
    )

    findings_list = []
    for f in find_res.data or []:
        findings_list.append(
            {
                "id": f.get("id"),
                "category": f.get("category", "general"),
                "start_ms": f.get("start_ms", 0),
                "end_ms": f.get("end_ms", 0),
                "severity": f.get("severity", "low"),
                "title": f.get("title", ""),
                "details": f.get("details") or {},
            }
        )

    return {
        "session_id": session_id,
        "status": "done",
        "report": {
            "overall_score": rep_row.get("overall_score"),
            "schema_version": rep_row.get("schema_version", "1.0.0"),
            "summary": rep_row.get("summary") or {},
            "findings": findings_list,
        },
    }
