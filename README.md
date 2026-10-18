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

![Tech stack diagram](./assets/tech-stack-diagram.png)
<!-- Replace with your diagram: add the image to an /assets folder and update the path above -->

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React.js, Paper Design | … |
| Backend | Node.js, Python | … |
| Database | Supabase, PostgreSQL | … |
| AI / APIs | Claude Code, Gemini API, Assembly AI  | … |

**How it fits together:** A sentence or two describing how data flows through the system.

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

## 👥 Team

| Name | Role | GitHub |
|------|------|--------|
|Ronald Narain| Frontend Developer | [@ronaldgabrieln](https://github.com/ronaldgabrieln) |
|Emiliano Gonzalez| Backend Developer | [@Emiliano0X1](https://github.com/Emiliano0X1) |
|Leonardo Piedras| AI Systems Developer | [@lpiedras4](https://github.com/lpiedras4) |
