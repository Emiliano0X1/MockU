import os
import time
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv

from app.schemas import (
    HealthResponse,
    AnalyzeRequest,
    AnalyzeResponse,
    MetricsResult,
    AnalyzeInterviewRequest,
    AnalyzeInterviewResponse,
)
from app.services.transcription import transcribe_audio
from app.services.metrics import calculate_metrics
from app.services.evaluations import evaluate_response, summarize_interview
from app.services.moments import answer_windows, build_segments, timed_findings
from app.services.utils import extract_text_from_pdf

load_dotenv()

app = FastAPI(title="AI Interview Service")

@app.get("/health", response_model=HealthResponse)
def health_check():
    return HealthResponse(status="ok", environment=os.getenv("ENVIRONMENT", "dev"))

@app.post("/analyze/session", response_model=AnalyzeResponse)
def analyze_session(request: AnalyzeRequest):
    try:
        # 1. Extraer texto del PDF
        print(f"[{request.session_id}] 1. Downloading and reading PDF...")
        resume_text = extract_text_from_pdf(request.resume_pdf_url)

        # 2. Transcribir Audio
        print(f"[{request.session_id}] 2. Transcribing audio from AssemblyAI...")
        transcription_result = transcribe_audio(request.audio_url)
        words_data = transcription_result["words"]
        full_text = transcription_result["full_text"]

        # 3. Calcular Métricas
        print(f"[{request.session_id}] 3. Calculating deterministic metrics...")
        metrics = calculate_metrics(words_data, language=request.language)

        # 4. Evaluación Contextual con LLM
        print(f"[{request.session_id}] 4. Evaluating response with Gemini...")
        feedback = evaluate_response(
            question=request.question,
            transcript=full_text,
            resume_text=resume_text,
            job_description=request.job_description
        )

        # 5. Armar la respuesta
        print(f"[{request.session_id}] ✅ Analysis complete.")
        return AnalyzeResponse(
            session_id=request.session_id,
            metrics=MetricsResult(**metrics),
            transcript_text=full_text,
            feedback=feedback
        )

    except Exception as e:
        print(f"Error en /analyze/session: {e}")
        # Si algo explota, le devolvemos un error HTTP 500 al backend para que sepa que falló
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/interview", response_model=AnalyzeInterviewResponse)
def analyze_interview(request: AnalyzeInterviewRequest):
    """
    Analyzes a whole mock interview recorded as ONE audio file: transcribes it
    once, splits the answers by each question's asked_at_ms, and returns
    transcript segments, delivery metrics, timed findings and a scored summary.
    """
    sid = request.session_id
    started = time.monotonic()
    log = lambda msg: print(f"[{sid}] {msg} (+{time.monotonic() - started:.1f}s)")
    try:
        resume_text = request.resume_text
        if not resume_text and request.resume_pdf_url:
            log("1. Reading resume PDF...")
            resume_text = extract_text_from_pdf(request.resume_pdf_url)

        log("2. Transcribing the interview with AssemblyAI...")
        transcription = transcribe_audio(request.audio_url)
        words = transcription["words"]
        full_text = transcription["full_text"] or ""
        audio_end_ms = words[-1]["end"] if words else 0
        log(f"   {len(words)} words")

        log("3. Delivery metrics and timed moments...")
        metrics = calculate_metrics(words, language=request.language)
        findings = timed_findings(words, language=request.language)
        segments = build_segments(words)

        windows = answer_windows([q.model_dump() for q in request.questions], words, audio_end_ms)
        answers = []
        for window in windows:
            answer_metrics = calculate_metrics(window["words"], language=request.language)
            answers.append({"question": window["question"], "transcript": window["transcript"], "metrics": answer_metrics})
            if not window["transcript"]:
                continue
            log(f"4. Gemini feedback for question {window['position']}...")
            feedback = evaluate_response(
                question=window["question"],
                transcript=window["transcript"],
                resume_text=resume_text,
                job_description=request.job_description,
            )
            for item in feedback:
                if item.get("criterion") == "system_error":
                    continue
                findings.append({
                    "category": item["criterion"],
                    "start_ms": window["words"][0]["start"],
                    "end_ms": window["words"][-1]["end"],
                    "severity": "medium",
                    "title": item["criterion"].replace("_", " ").capitalize(),
                    "details": {
                        "note": f"{item['observation']} {item['improvement']}".strip(),
                        "observation": item["observation"],
                        "improvement": item["improvement"],
                        "question": window["question"],
                    },
                })

        log("5. Gemini interview summary...")
        summary = summarize_interview(
            answers=answers,
            metrics=metrics,
            resume_text=resume_text,
            job_description=request.job_description,
            heart_rate_events=[e.model_dump() for e in request.heart_rate_events],
        )

        log(f"✅ Done: score {summary['overall_score']}, {len(findings)} findings, {len(segments)} segments")
        return AnalyzeInterviewResponse(
            session_id=sid,
            transcript_text=full_text,
            segments=segments,
            metrics=MetricsResult(**metrics),
            findings=sorted(findings, key=lambda f: f["start_ms"]),
            summary=summary,
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        log(f"❌ Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
