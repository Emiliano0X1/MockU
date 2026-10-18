import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

# Cargamos las variables de entorno
load_dotenv()

# Cliente de Gemini (lee la llave desde GEMINI_API_KEY)
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

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
        response = client.models.generate_content(
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
        traceback.print_exec()
      # Return a feedback that signals an error from the AI.
        return [{
            "criterion": "system_error", 
            "observation": "Could not generate feedback due to an AI error.", 
            "improvement": "Try again later."
        }]