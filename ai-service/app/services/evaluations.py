import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

# Cargamos las variables de entorno
load_dotenv()

def get_client():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not configured in .env file.")
    return genai.Client(api_key=api_key)


class Feedback(BaseModel):
    criterion: str
    observation: str
    improvement: str

def evaluate_response(
    question: str, 
    transcript: str, 
    resume_text: str, 
    job_description: str
) -> list:
    """
    Takes all the interview context and asks Gemini for a structured evaluation
    """
    if not os.getenv("GEMINI_API_KEY"):
        raise ValueError("GEMINI_API_KEY not configured in .env file.")

    #Prompt: Clear instructions, defined roles, and injected context
    prompt = f"""
    You are an expert technical interviewer and communication coach.
    Analyze the candidate's answer based on the following context.
    
    [CONTEXT]
    Interview Question: {question}
    Job Description: {job_description}
    Candidate Resume: {resume_text}
    
    [CANDIDATE ANSWER TRANSCRIPT]
    {transcript}
    
    [INSTRUCTIONS]
    Provide specific, actionable feedback for the candidate. 
    Focus on criteria like 'problem_solving', 'clarity', 'relevance', or 'technical_accuracy'.
    Do not invent facts about the candidate's background. Base your observation ONLY on the transcript and resume.
    
    You must respond ONLY with a valid JSON array of objects. Each object must have exactly these keys: 
    "criterion" (string), "observation" (string), "improvement" (string).
    """

    try:
        # Gemini 3.8 Flash: fast and cheap. Schema enforces the JSON shape.
        response = get_client().models.generate_content(
            model="gemini-3.8-flash",

            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=list[Feedback],
            ),
        )

        # Convert JSON string from Gemini to a dict list in Python
        feedback_list = json.loads(response.text)
        return feedback_list

    except Exception as e:
        #print(f"Error en la evaluación de Gemini: {e}")
        import traceback
        print("Gemini Error")
        traceback.print_exc()
      # Return a feedback that signals an error from the AI.
        return [{
            "criterion": "system_error",
            "observation": "Could not generate feedback due to an AI error.",
            "improvement": "Try again later."
        }]


class InterviewSummary(BaseModel):
    overall_score: int
    communication_score: int
    technical_depth_score: int
    composure_score: int
    overview: str
    key_strengths: list[str]
    areas_for_growth: list[str]


def summarize_interview(
    answers: list,
    metrics: dict,
    resume_text: str,
    job_description: str,
    heart_rate_events: list,
) -> dict:
    """
    One Gemini call over the whole interview: 0-100 scores, a one-line
    overview, and strengths / areas for growth for the results screen.
    `answers` is a list of {"question", "transcript", "metrics"}.
    """
    if not os.getenv("GEMINI_API_KEY"):
        raise ValueError("GEMINI_API_KEY not configured in .env file.")

    qa = "\n\n".join(
        f"Q{i + 1}: {a['question']}\nAnswer: {a['transcript'] or '(no answer)'}\nDelivery: {json.dumps(a['metrics'])}"
        for i, a in enumerate(answers)
    )
    spikes = "\n".join(f"- at {e['t_ms'] // 1000}s: {e.get('bpm_at_trigger')} bpm (resting {e.get('baseline_bpm')})" for e in heart_rate_events) or "none"

    prompt = f"""
    You are an expert behavioral interviewer and communication coach.
    Score this mock interview for an entry-level candidate.

    [CONTEXT]
    Job / company: {job_description}
    Candidate resume: {resume_text}

    [INTERVIEW]
    {qa}

    [WHOLE-INTERVIEW DELIVERY METRICS]
    {json.dumps(metrics)}

    [HEART-RATE SPIKES DURING THE INTERVIEW]
    {spikes}

    [INSTRUCTIONS]
    - overall_score, communication_score, technical_depth_score, composure_score: integers 0-100.
      Communication = clarity, structure, filler words, pace. Technical depth = specifics, ownership,
      results. Composure = pauses, restarts, heart-rate spikes.
    - overview: one short sentence addressed to the candidate ("You ...").
    - key_strengths and areas_for_growth: 2-3 short, specific bullet sentences each, addressed to the candidate.
    - Base everything ONLY on the transcript, metrics and resume. Do not invent facts.
    - If an answer is missing or empty, score it low and say so.
    """

    response = get_client().models.generate_content(
        model="gemini-3.8-flash",

        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=InterviewSummary,
        ),
    )
    summary = json.loads(response.text)
    for key in ("overall_score", "communication_score", "technical_depth_score", "composure_score"):
        summary[key] = max(0, min(100, int(summary[key])))
    return summary