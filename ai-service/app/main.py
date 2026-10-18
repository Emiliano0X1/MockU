import os 
from fastapi import FastAPI
from dotenv import load_dotenv
from app.schemas import HealthResponse

load_dotenv()

app = FastAPI(
  title = "AI Interview Service",
  description = "API for interview analysis - Project for AI LA HACKS 2026",
  version = "1.0.0"
)

@app.get("/health", response_model = HealthResponse)
def healthCheck():
  """
  Endpoint to check service is on
  """
  return HealthResponse(
    status ="ok",
    environment =os.getenv("ENVIRONMENT","unknown")
  )
  
@app.post("/analyze/session")
def analyze_Session():
  return {"message": "Endpoint in construction - phase 5"}