# MockU AI Interview Coach — Backend API Documentation

Welcome to the backend service for the **MockU AI Interview Coach** (AI LA Hackathon 2026). This guide provides the complete API contracts, request/response examples, and step-by-step integration workflow for the frontend dashboard and smart glasses app.

---

## 🌐 Server & Base URLs

- **Local Base API**: `http://localhost:8000/api/v1`
- **Interactive Swagger Docs**: `http://localhost:8000/docs`
- **Live Glasses WebSocket**: `ws://localhost:8000/ws/sessions/{session_id}/glasses`
- **Health Check**: `http://localhost:8000/health`

---

## 📋 Global Conventions

1. **Authentication**: None for hackathon scope. The frontend identifies the candidate using `profile_id` (store in `localStorage`).
2. **Error Shape**: All errors follow the strict envelope:
   ```json
   {
     "error": {
       "code": "STRING_ERROR_CODE",
       "message": "Human-readable explanation"
     }
   }
   ```
3. **Time Contract**: All `*_ms` timestamps represent **elapsed milliseconds** since `started_at` (`t = 0`). Never send wall-clock time.
4. **Session Status Flow**: `recording` ➔ `processing` ➔ `done` (or `failed`).

---

## 🚀 End-to-End Frontend Integration Workflow

```
[1. Create Profile] ➔ [2. Pick Company] ➔ [3. Upload Resume] 
        ➔ [4. Start Session] ➔ [5. Live Mode & Questions] 
        ➔ [6. End Session] ➔ [7. Upload Audio] ➔ [8. View Report]
```

---

### Step 1: Candidate Profile (Identification)

Candidates are identified by a `profile_id`. Store this ID in `localStorage` upon creation.

#### `POST /api/v1/profiles`
- **Body**:
  ```json
  {
    "full_name": "Alex Rivera",
    "experience_level": "intern"
  }
  ```
  *(Allowed `experience_level`: `"intern"` | `"new_grad"`)*
- **Response (`201 Created`)**:
  ```json
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "full_name": "Alex Rivera",
    "experience_level": "intern",
    "created_at": "2026-10-17T20:00:00Z"
  }
  ```

#### `GET /api/v1/profiles/{id}`
- **Response (`200 OK`)**: Same as above plus `"updated_at"`.

---

### Step 2: Company Picker

#### `GET /api/v1/companies`
Retrieve mock company catalog for the interview setup screen.
- **Response (`200 OK`)**:
  ```json
  [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "name": "Stripe",
      "industry": "Fintech",
      "culture_summary": "High ownership, written communication, and rigorous technical execution.",
      "values": [
        { "name": "Move Fast", "description": "Iterate rapidly and learn from feedback" }
      ],
      "website_url": "https://stripe.com"
    }
  ]
  ```

---

### Step 3: Resume Management

#### Check Active Resume: `GET /api/v1/profiles/{profile_id}/resume`
- **Response (`200 OK`)**:
  ```json
  {
    "id": "4d12c822-4469-4e44-8cb8-251f28b21c43",
    "original_filename": "alex_cv.pdf",
    "char_count": 2840,
    "created_at": "2026-10-17T20:05:00Z",
    "updated_at": "2026-10-17T20:05:00Z"
  }
  ```
- **Response (`404 Not Found`)**: Returns code `"resume_not_found"`. Use this to trigger the upload screen.

#### Upload Resume: `POST /api/v1/resumes`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: PDF file (max 5 MB)
  - `profile_id`: UUID
- **Response (`201 Created`)**:
  ```json
  {
    "id": "4d12c822-4469-4e44-8cb8-251f28b21c43",
    "original_filename": "alex_cv.pdf",
    "char_count": 2840,
    "text_preview": "Alex Rivera - Software Engineer intern with experience in distributed systems...",
    "created_at": "2026-10-17T20:05:00Z"
  }
  ```

#### Delete Resume: `DELETE /api/v1/profiles/{profile_id}/resume`
- **Response (`204 No Content`)**: Deletes file from storage and database. Rejects with `409` if a session is currently processing.

---

### Step 4: Start Interview Session

#### `POST /api/v1/sessions`
Initializes interview, locks `t = 0` (`started_at`), and selects randomized questions.
- **Body**:
  ```json
  {
    "profile_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "company_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "resume_id": "4d12c822-4469-4e44-8cb8-251f28b21c43",
    "role_title": "SWE Intern",
    "question_count": 6
  }
  ```
- **Response (`201 Created`)**:
  ```json
  {
    "id": "e83726a1-9492-4f9e-a868-d069c9b1392e",
    "status": "recording",
    "started_at": "2026-10-17T20:10:00Z",
    "company_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "resume_id": "4d12c822-4469-4e44-8cb8-251f28b21c43",
    "role_title": "SWE Intern",
    "questions": [
      {
        "position": 1,
        "question_id": "b1031bfe-85fc-4eb1-9976-154dfc4a52ef",
        "text": "Tell me about a challenging project and how you solved a scaling bottleneck.",
        "category": "Behavioral",
        "asked_at_ms": null
      }
    ]
  }
  ```

---

### Step 5: Live Mode (Glasses WebSocket & Questions Timeline)

#### Glasses WebSocket: `WS /ws/sessions/{id}/glasses`
Connect the glasses companion app immediately when the interview begins.

- **Server ➔ Glasses Messages**:
  - **Suggestion Alert**:
    ```json
    {
      "type": "suggestion",
      "id": "uuid",
      "t_ms": 68000,
      "text": "Take a slow breath",
      "severity": "medium",
      "ttl_ms": 6000
    }
    ```
    *(The frontend should display `text` for `ttl_ms` (6s) and then dismiss).*
  - **Sensor Status**:
    ```json
    { "type": "sensor_status", "state": "online", "last_bpm": 84 }
    ```
  - **Session Ended**:
    ```json
    { "type": "session_ended" }
    ```
  - **Heartbeat Ping**:
    ```json
    { "type": "ping" }
    ```

- **Glasses ➔ Server Messages**:
  - **Acknowledgment (Optional)**:
    ```json
    { "type": "ack", "suggestion_id": "uuid" }
    ```
  - **Pong (Heartbeat)**:
    ```json
    { "type": "pong" }
    ```

#### Record Question Display Time: `PATCH /api/v1/sessions/{id}/questions/{position}`
Call this the exact millisecond a question appears on screen:
- **Body**:
  ```json
  { "asked_at_ms": 2500 }
  ```
- **Response (`200 OK`)**: `{ "position": 1, "asked_at_ms": 2500 }`

#### Send Manual Test Suggestion: `POST /api/v1/sessions/{id}/suggestions/test`
Test the glasses HUD without a pulse spike or watch:
- **Body**:
  ```json
  {
    "text": "Test: take a slow breath",
    "severity": "medium"
  }
  ```
- **Response (`202 Accepted`)**: `{ "id": "uuid", "delivered": true }`

#### Ingest Wearable Biometrics (Simulator / Watch): `POST /api/v1/sessions/{id}/biometrics`
- **Body**:
  ```json
  {
    "samples": [
      { "t_ms": 1000, "bpm": 74 },
      { "t_ms": 2000, "bpm": 76 }
    ]
  }
  ```
- **Response (`201 Created`)**: `{ "inserted": 2 }`

---

### Step 6: End Interview Session

#### `POST /api/v1/sessions/{id}/end`
Stops the live tracking, closes the glasses connection, and calculates duration.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "e83726a1-9492-4f9e-a868-d069c9b1392e",
    "status": "recording",
    "ended_at": "2026-10-17T20:25:00Z",
    "duration_ms": 900000
  }
  ```

---

### Step 7: Upload Audio & Trigger AI Processing

#### `POST /api/v1/sessions/{id}/audio`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: Audio recording (`webm`, `mp3`, `wav`, or `m4a`)
  - `duration_ms`: (Optional integer)
- **Response (`202 Accepted`)**:
  ```json
  {
    "session_id": "e83726a1-9492-4f9e-a868-d069c9b1392e",
    "status": "processing"
  }
  ```
The post-interview pipeline runs in the background.

---

### Step 8: Results, Dashboard & History

#### Poll Session Status: `GET /api/v1/sessions/{id}`
Poll every few seconds until `status == "done"`.
- **Response (`200 OK`)**:
  ```json
  {
    "id": "e83726a1-9492-4f9e-a868-d069c9b1392e",
    "status": "done",
    "has_audio": true,
    "report_ready": true,
    "questions": [...]
  }
  ```

#### Final Evaluation Report: `GET /api/v1/sessions/{id}/report`
- **Response (`200 OK`)**:
  ```json
  {
    "session_id": "e83726a1-9492-4f9e-a868-d069c9b1392e",
    "status": "done",
    "report": {
      "overall_score": 88,
      "schema_version": "1.0.0",
      "summary": {
        "communication_score": 90,
        "technical_depth_score": 85,
        "composure_score": 89,
        "key_strengths": ["Clear architecture explanations"],
        "areas_for_growth": ["Elaborate on edge case testing"]
      },
      "findings": [
        {
          "id": "uuid",
          "category": "biometric",
          "start_ms": 20100,
          "end_ms": 24000,
          "severity": "medium",
          "title": "Mild elevated heart rate spike",
          "details": { "note": "BPM rose to 118 when discussing scalability bottlenecks." }
        }
      ]
    }
  }
  ```

#### Time-Aligned Transcript: `GET /api/v1/sessions/{id}/transcript`
Use `start_ms` and `end_ms` to highlight phrases matching findings.
- **Response (`200 OK`)**:
  ```json
  {
    "session_id": "uuid",
    "status": "done",
    "segments": [
      {
        "start_ms": 1000,
        "end_ms": 7500,
        "text": "Thank you for having me today..."
      }
    ]
  }
  ```

#### Biometric Chart Series: `GET /api/v1/sessions/{id}/biometrics`
Pre-bucketed for responsive dashboard charting.
- **Query Params**: `max_points=300`, `from_ms`, `to_ms`
- **Response (`200 OK`)**:
  ```json
  {
    "session_id": "uuid",
    "stats": {
      "count": 300,
      "min_bpm": 68,
      "max_bpm": 122,
      "avg_bpm": 82.4,
      "baseline_bpm": 74
    },
    "points": [
      { "t_ms": 1000, "bpm_avg": 74.2, "bpm_max": 78 }
    ]
  }
  ```

#### Candidate History: `GET /api/v1/sessions?profile_id={profile_id}`
- **Query Params**: `profile_id` (required), `status` (optional), `limit=20`, `offset=0`
- **Response (`200 OK`)**:
  ```json
  {
    "items": [
      {
        "id": "uuid",
        "company": { "id": "uuid", "name": "Stripe" },
        "role_title": "SWE Intern",
        "status": "done",
        "started_at": "2026-10-17T20:10:00Z",
        "ended_at": "2026-10-17T20:25:00Z",
        "duration_ms": 900000,
        "overall_score": 88
      }
    ],
    "total": 1
  }
  ```

#### Re-run Analysis Pipeline: `POST /api/v1/sessions/{id}/reprocess`
- **Response (`202 Accepted`)**: `{ "session_id": "uuid", "status": "processing" }`

#### Delete Session: `DELETE /api/v1/sessions/{id}`
- **Response (`204 No Content`)**: Cascades deletion across database and deletes audio recording from storage.

---

## 🛠️ Developer Tools & Simulators

1. **Simulate Heart Rate Spikes (No Apple Watch needed)**:
   ```powershell
   python scripts/simulate_bpm.py --session-id <SESSION_UUID> --scenario sustained_spike
   ```
2. **Inspect Pulsoid Watch Feed**:
   ```powershell
   python scripts/pulsoid_explore.py
   ```