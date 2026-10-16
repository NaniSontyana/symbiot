# Symbiot Copilot — Real-Time AI Interview Assistant

A complete **ParakeetAI-style interview copilot**: it listens to your live
interview (system audio + microphone, or one shared microphone with automatic
voice separation), transcribes it in real time with NVIDIA Parakeet
end-of-utterance streaming ASR, detects interviewer questions, and streams a
tailored, resume-aware answer to a stealth overlay — in under a second.

```
┌──────────────────────────┐        ┌──────────────────────────┐        ┌──────────────────────────┐
│   my-react-app           │ ws/api │   backend-gateway        │   SQL  │   PostgreSQL + pgvector  │
│   React 19 + Vite        │───────▶│   Node.js / Express      │───────▶│   users · sessions       │
│   Electron stealth shell │        │   /ws/copilot streaming  │        │   documents (RAG)        │
│   AudioWorklet 16 kHz    │ PCM ws │   RAG · LLM router       │        │   transcripts            │
└──────────┬───────────────┘───────▶│                          │        └──────────────────────────┘
           │                        └──────────▲───────────────┘
           │ ┌──────────────────────────┐      │ questions
           └▶│   asr-service            │──────┘
             │   Python / FastAPI       │ transcripts
             │   Parakeet EOU 120M      │
             │   Sortformer diarization │
             └──────────────────────────┘
```

## Features

- **Real-time transcription** — NVIDIA `parakeet_realtime_eou_120m` streaming
  ASR with true end-of-utterance detection (~80 ms steps), energy VAD gating,
  partials + finals, per-channel state isolation.
- **Speaker attribution 3 ways** — dual-channel capture (system audio =
  interviewer, mic = you), automatic one-mic voice separation with Streaming
  Sortformer diarization, and a manual toggle fallback. Echo guard drops mic
  pickup of the interviewer's voice.
- **Intelligent question detection** — a client-side turn manager stitches
  multi-utterance interviewer turns, strips pleasantries and meeting chatter,
  deduplicates n-grams, and only ever answers interviewer speech.
- **Streaming copilot answers** — multi-provider LLM router (Groq →
  OpenRouter → Gemini → built-in offline engine) with rich, structured,
  interview-ready answers incl. runnable code blocks. RAG over your resume and
  the job description (pgvector HNSW, or in-memory cosine search).
- **Stealth overlay** — frameless always-on-top Electron window, screen-share
  protection (`setContentProtection`), click-through mode, global hotkeys,
  opacity slider, collapses to a draggable floating badge.
- **Accounts** — bcrypt-hashed sign-in/sign-up with JWT (or one-click demo
  mode, no account needed).
- **Runs anywhere** — no GPU, no API keys, no database required: a mock ASR
  engine simulates the interviewer, the offline LLM tier answers, and the
  gateway falls back to an in-memory store. Add real services whenever you
  want; every layer upgrades independently.

## Quick Start (zero-config demo)

Prerequisites: Node ≥ 18, Python ≥ 3.10.

```bash
# 1. Backend gateway (terminal 1)
cd backend-gateway
npm install
cp .env.example .env
npm start                     # http://localhost:5000

# 2. ASR service in simulation mode (terminal 2)
cd asr-service
python3 -m venv .venv && source .venv/bin/activate
pip install fastapi "uvicorn[standard]" websockets numpy pydantic python-dotenv
ASR_ENGINE=mock python app.py # http://localhost:8000

# 3. Frontend overlay (terminal 3)
cd my-react-app
npm install
npm run dev                   # http://localhost:5174
```

Open http://localhost:5174, press **Continue as Demo**, allow the microphone,
and the simulated interviewer starts asking questions with streamed answers.
In **mode `manual`**, click the speaker toggle so it reads
*“1. Listening for Interviewer”* — anything said into the mic is then treated
as interviewer speech and answered by the copilot.

### Full production stack

- **Real ASR**: `pip install -r requirements.txt` (NeMo + torch; downloads the
  Parakeet model from Hugging Face on first run) and keep `ASR_ENGINE=parakeet`.
  A CUDA GPU is recommended; diarization (`ASR_DIARIZATION=1`) separates voices
  on one microphone.
- **Database**: run PostgreSQL with pgvector (e.g. `docker compose up db`),
  then `npm run db:init` inside `backend-gateway`.
- **LLM keys**: set `GROQ_API_KEY`, `OPENROUTER_API_KEY` and/or
  `GEMINI_API_KEY` in `backend-gateway/.env`, or paste a key in the app's
  Resume settings modal — keys sent by the client win.
- **Desktop overlay**: `npm run electron:dev` inside `my-react-app` for the
  stealth always-on-top shell (hotkeys: `Ctrl+Alt+S` stealth size,
  `Ctrl+Alt+C` click-through, `Ctrl+Alt+H` hide, `Ctrl+Alt+D` switch display,
  `Ctrl+Alt+X` quit).

## Services

| Service            | Tech                | Port | Docs |
|--------------------|---------------------|------|------|
| `my-react-app`     | React 19, Vite, Electron | 5174 | overlay UI, audio capture, turn manager |
| `backend-gateway`  | Node.js, Express, ws     | 5000 | auth, sessions, RAG documents, copilot WS |
| `asr-service`      | Python, FastAPI, NeMo    | 8000 | streaming ASR, diarization, VAD, echo guard |
| `database`         | PostgreSQL + pgvector    | 5432 | schema + init scripts |

The Vite dev server proxies `/api` + `/ws/copilot` to the gateway and
`/ws/asr-transcribe` to the ASR service, so the browser never calls
`localhost` directly — the app works unchanged in remote dev environments.
Inside Electron, the renderer talks to `localhost` services directly.

## Configuration

- `backend-gateway/.env` — port, `DATABASE_URL`, `JWT_SECRET`, LLM keys
  (see [.env.example](backend-gateway/.env.example)).
- `asr-service/.env` — `ASR_ENGINE=parakeet|mock`, model ids, device,
  diarization knobs (see [.env.example](asr-service/.env.example)).
- Deep dive on the Parakeet streaming engine:
  [PARAKEET_EOU_120M_GUIDE.md](asr-service/PARAKEET_EOU_120M_GUIDE.md).

## Demo credentials

| Account | Email | Password |
|---------|-------|----------|
| Demo candidate | `candidate@symbiot.ai` | `demo1234` |

The demo account is seeded automatically in both PostgreSQL and in-memory
modes; skipping sign-in entirely (**Continue as Demo**) uses the same account.

## Testing

```bash
# Frontend: unit tests (turn manager) + lint + production build
cd my-react-app
npm test && npm run lint && npm run build

# ASR service: 34 tests around VAD gating, turn logic, echo guard, WS app
cd asr-service && source .venv/bin/activate
python -m pytest tests -q        # NeMo integration tests skip without GPU deps

# End-to-end copilot smoke test (gateway running)
cd backend-gateway && node test_copilot.js
```

## Project layout

```
symbiot/
├── backend-gateway/          # Node.js API + copilot WebSocket gateway
│   ├── src/config/           # db pool, schema init, unified app store (PG ↔ memory)
│   ├── src/routes/           # auth / sessions / documents (RAG upload & search)
│   ├── src/services/         # embeddings, multi-tier streaming LLM router
│   └── src/websockets/       # copilot question pipeline (filters + dispatch)
├── asr-service/              # Python streaming speech microservice
│   ├── app.py                # FastAPI WS app (/ws/transcribe, /health)
│   └── services/             # Parakeet EOU engine, Sortformer diarization,
│                             # mock simulation engine, transcriber, VAD, echo guard
├── my-react-app/             # React 19 overlay UI + Electron stealth shell
│   ├── electron/             # main process (hotkeys, protection, displays) + preload bridge
│   ├── public/               # AudioWorklet PCM processor, icons, logo
│   └── src/                  # App, components, useAudioStreamer, turn manager, api lib
└── database/                 # schema.sql (users, sessions, documents+pgvector, transcripts)
```
