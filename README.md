# Mock-U

> One-line tagline that sums up what your project does.

🏆 **Built for [AI LA Hacks] [2026]** · [Even Realities Building Challenge]

---

## 📖 What It Is

Web application made for the Even Realities smart glasses for software engineering students who want to simulate behavioral and system design interviews through an immersive experience with speech and pulse analysis to give a personalized AI-generated report of its performance.

## 🎥 Demo

[![Watch the demo](https://youtube.com/vi/YOUTUBE_VIDEO_ID)](https://www.youtube.com/watch?v=YOUTUBE_VIDEO_ID)

▶️ **[Watch the demo on YouTube](https://www.youtube.com/watch?v=YOUTUBE_VIDEO_ID)**


## 💡 Why We Built It

What problem inspired this project? Why does it matter, and what gap does it fill?

- **The problem:** Lack of resources for behavioral and system design interviews, which leads to sense of unpreparedness and lack of confidence.
- **Our solution:** AI web application with seamless integration to Even Realities glasses that allows users to practice interview scenarios anywhere, through a responsive and convenient experience.
- **The impact:** With the feedback generated on the interview report, interviewees can track their weaknesses, strengths, and how well they communicate their ideas and responses according to the company they're interviewing for. This leads to more preparedness and confidence-boost in interview performance.

## 🛠️ Tech Stack

![MockU system architecture](./ai-service/docs/architecture.png)

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript | The app's screens (setup, briefing, live interview, results, history). It runs inside the Even App WebView on the phone. |
| Frontend | Even Hub SDK (`@evenrealities/even_hub_sdk`) | Bridge to the Even Realities G2 glasses: draws questions, tips and the Mocky mascot on the 576×288 HUD, reads swipe, press and head-tilt input, and records the interview through the glasses mic. |
| Frontend | Paper Design | UI and HUD mockups made before building the screens. |
| Tooling | Node.js, Vite | Node runs the dev server and the build. Vite bundles the app into `dist/`, which is packaged as `mocku.ehpk` for the Even App. |
| Backend | Python, FastAPI (`:8000`) | Main API: profiles, companies, resumes, sessions, biometrics and audio upload. Runs the analysis as a background task and saves the report. |
| Backend | WebSockets | Pushes live tips, sensor status and session events to the glasses while the interview runs. |
| Backend | Pulsoid | Streams live heart rate from an Apple Watch. A spike detector compares it to a baseline and sends a calming tip to the HUD. |
| Backend | PyMuPDF, pypdf | Extracts the text of the uploaded resume PDF once, so the AI can personalize the feedback. |
| Database | Supabase (PostgreSQL) | Stores profiles, companies, questions, sessions, heart-rate samples, live tips, transcripts and reports. |
| Database | Supabase Storage | Holds resume PDFs (`resumes/`) and interview recordings (`audio/`). The backend shares a signed audio URL with the AI service. |
| AI | Python, FastAPI (`:8001`) | Stateless analysis service: transcribes the interview, measures delivery, finds timed moments and builds the report. Only the backend calls it. |
| AI | AssemblyAI | Speech-to-text with word-level timestamps, used to split the transcript into one answer per question and to find pauses, filler words and repetitions. |
| AI | Google Gemini (`gemini-3.8-flash`) | Gives feedback on each answer and scores the whole interview (four 0–100 scores, overview, strengths, areas for growth), using the resume, role and company values. |
| Dev tools | Claude Code | AI coding assistant used while building the project. |

**How it fits together:** The glasses show each question and record the whole interview while Pulsoid streams heart rate to the backend, which pushes calming tips back to the HUD over a WebSocket. When the interview ends, the app uploads the recording; the backend stores it in Supabase and sends it with the questions, resume and heart-rate spikes to the AI service. There, AssemblyAI transcribes it and Gemini evaluates it. The backend saves the report, and the app shows it with the transcript and heart-rate chart on a shared timeline. See [ai-service/README.md](./ai-service/README.md) for the full data flow.

## 🚀 Getting Started

**Needs:** Node 20, Python 3.11, a Supabase project, and API keys for Gemini and AssemblyAI (Pulsoid is optional).

```bash
git clone https://github.com/Emiliano0X1/MockU.git && cd MockU
```

**1. AI service** (port 8001): copy `ai-service/.env.example` to `.env` and set `GEMINI_API_KEY` and `ASSEMBLYAI_API_KEY`.
```bash
cd ai-service && pip install -r requirements.txt
uvicorn app.main:app --port 8001
```

**2. Backend** (port 8000): copy `Backend/.env.example` to `.env` and set `SUPABASE_URL` and `SUPABASE_KEY` (plus `PULSOID_ACCESS_TOKEN` and `PULSOID_ENABLED=true` for live heart rate).
```bash
cd Backend && pip install -r requirements.txt
python -m src.app
```

**3. App:** copy `.env.example` to `.env.local` and set `VITE_API_URL=http://<your-LAN-IP>:8000`. Leave it empty to try the whole flow with the built-in mock server.
```bash
npm install
npm run dev        # browser preview
npm run build      # build dist/ to package for the Even App on the G2 glasses
```

No watch? Simulate a heart-rate spike:
```bash
python Backend/scripts/simulate_bpm.py --session-id <SESSION_ID> --scenario sustained_spike
```

## 👥 Team

| Name | Role | GitHub |
|------|------|--------|
|Ronald Narain| Frontend Developer | [@ronaldgabrieln](https://github.com/ronaldgabrieln) |
|Emiliano Gonzalez| Backend Developer | [@Emiliano0X1](https://github.com/Emiliano0X1) |
|Leonardo Piedras| AI Systems Developer | [@lpiedras4](https://github.com/lpiedras4) |
