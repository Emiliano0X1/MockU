import os
import json
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel

# Cargamos las variables de entorno
load_dotenv()

_client = None


def get_client():
    # Created once and reused: a Client that goes out of scope closes its HTTP
    # connection, so `get_client().models...` with a fresh client fails with
    # "Cannot send a request, as the client has been closed".
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not configured in .env file.")
        _client = genai.Client(api_key=api_key)
    return _client


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


# Node types the backend accepts (Backend/src/models/system_design.py NodeType).
GRAPH_NODE_TYPES = [
    "client", "load_balancer", "api_service", "cache", "database",
    "queue", "object_storage", "cdn", "worker",
]


class GraphNodeOut(BaseModel):
    id: str
    type: str
    label: str
    description: str


class GraphEdgeOut(BaseModel):
    id: str
    source: str
    target: str
    label: str
    protocol: str


class ArchitectureGraph(BaseModel):
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]


def extract_architecture_graph(prompt: str, transcript: str) -> dict:
    """
    Turns a spoken system design answer into a graph of components (nodes)
    and connections (edges). Returns a dict matching schemas.GraphOut.
    Only components the candidate actually described are included.
    """
    if not transcript.strip():
        return {"schema_version": "1.0.0", "prompt": prompt, "nodes": [], "edges": []}

    instructions = f"""
    You are a senior software architect. A candidate described a system design out loud.
    Turn ONLY what they described into an architecture graph.

    [DESIGN PROMPT]
    {prompt}

    [CANDIDATE'S SPOKEN DESIGN]
    {transcript}

    [RULES]
    - nodes: one per component the candidate mentioned. type MUST be one of:
      {", ".join(GRAPH_NODE_TYPES)}.
      Map anything else to the closest type (e.g. Redis -> cache, Postgres -> database,
      Kafka -> queue, S3 -> object_storage, a microservice -> api_service, a cron job -> worker).
    - id: short snake_case, unique, e.g. "node_api". label: the name they used, e.g. "Redis Cache".
      description: one short sentence on its role.
    - edges: one per connection they described or clearly implied (data flows from source to target).
      id like "edge_1". label: what flows, e.g. "read feed". protocol: e.g. HTTPS, gRPC, SQL, or "" if unknown.
    - Do not invent components the candidate did not describe.
    """

    response = get_client().models.generate_content(
        model="gemini-3.8-flash",
        contents=instructions,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ArchitectureGraph,
        ),
    )
    raw = json.loads(response.text)

    # Enforce the backend's rules: allowed types, unique ids, edges between known nodes.
    nodes, ids = [], set()
    for n in raw.get("nodes", []):
        node_id = (n.get("id") or "").strip() or f"node_{len(nodes) + 1}"
        if node_id in ids:
            node_id = f"{node_id}_{len(nodes) + 1}"
        ids.add(node_id)
        node_type = n.get("type") if n.get("type") in GRAPH_NODE_TYPES else "api_service"
        nodes.append({
            "id": node_id,
            "type": node_type,
            "label": n.get("label") or node_type.replace("_", " ").title(),
            "description": n.get("description") or None,
        })
    edges = [
        {
            "id": e.get("id") or f"edge_{i + 1}",
            "source": e["source"],
            "target": e["target"],
            "label": e.get("label") or None,
            "protocol": e.get("protocol") or None,
        }
        for i, e in enumerate(raw.get("edges", []))
        if e.get("source") in ids and e.get("target") in ids and e.get("source") != e.get("target")
    ]
    return {"schema_version": "1.0.0", "prompt": prompt, "nodes": nodes, "edges": edges}