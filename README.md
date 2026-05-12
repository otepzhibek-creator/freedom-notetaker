# Freedom AI Notetaker

AI-powered meeting notetaker with real-time transcription, speaker diarization, and Notion-style analysis.

## Features

- **Real-time transcription** via Freedom Speech WS-ASR WebSocket
- **File upload** (audio/video) via Freedom Speech STT
- **Speaker diarization** via pyannote.audio (identifies who is speaking)
- **AI analysis** via Claude — summary, action items, decisions, key topics
- **Web app** — clean React interface

## Quick Start

### 1. Configure environment

```bash
cd backend
cp .env.example .env
# Edit .env and fill in your keys
```

Required keys:
- `FREEDOM_API_KEY` — Freedom Speech API key (freedomspeech.kz)
- `ANTHROPIC_API_KEY` — Claude API key
- `HF_TOKEN` — HuggingFace token (for pyannote diarization)
  - Accept model license at https://hf.co/pyannote/speaker-diarization-3.1

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Or via Docker

```bash
cp backend/.env.example backend/.env
# fill in keys
docker compose up --build
```

## API Notes

The Freedom Speech integration is in `backend/services/freedom_client.py`.
Review and adjust the endpoint URLs and response parsing to match the actual API:
- STT: `FREEDOM_STT_URL` (file upload)
- WS-ASR: `FREEDOM_WS_URL` (real-time WebSocket)

## Architecture

```
frontend (React + Vite)
    ↓ WebSocket /ws/transcribe/{id}
    ↓ REST /api/*
backend (FastAPI)
    ↓ HTTP POST          ↓ WebSocket
Freedom STT API    Freedom WS-ASR
    +
pyannote.audio (diarization)
    +
Claude API (analysis)
    +
SQLite (meetings + segments + analysis)
```
