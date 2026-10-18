import os
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv

from app.schemas import HealthResponse, AnalyzeRequest, AnalyzeResponse, MetricsResult
from app.services.transcription import transcribe_audio
from app.services.metrics import calculate_metrics
from app.services.evaluations import evaluate_response
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