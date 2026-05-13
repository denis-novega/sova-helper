# Sova

Sova is a local desktop study assistant that turns learning sources into structured notes. It accepts YouTube links, web articles, audio/video files, presentations and documents, then extracts text, transcribes speech, parses slides/documents, summarizes sources and can assemble a final study note.

## What it does

- Imports local files: audio, video, DOC/DOCX, PDF, TXT/MD, PPT/PPTX.
- Imports online sources: YouTube, Google Docs/Drive links and general web pages.
- Transcribes audio/video locally with Faster Whisper.
- Extracts slide text and optional OCR from presentations/PDF slides.
- Extracts readable article text from web pages.
- Stores processing artifacts in a local workspace.
- Creates per-source summaries and a combined final note.
- Exports notes as DOCX or via browser print-to-PDF.

## Architecture

```text
React/Vite UI  ->  FastAPI engine on 127.0.0.1:7861  ->  local workspace artifacts
      |                       |
      |                       +-- transcription, parsing, OCR, summarization, RAG
      |
      +-- Tauri desktop shell
```

The application is local-first for file handling: uploaded files are processed by the local Python backend and artifacts are stored locally. Source summaries and final composition currently use the OpenAI API when `OPENAI_API_KEY` is configured. The chat/RAG flow uses a local Ollama model by default.

## Project layout

```text
engine/        Python FastAPI backend and processing pipeline
ui/            React/Vite frontend
src-tauri/     Tauri desktop wrapper and bundling configuration
scripts/       Development helper scripts
```

## Requirements

- Node.js and npm
- Rust toolchain for Tauri builds
- Python 3.10+
- FFmpeg
- Tesseract OCR for slide/image OCR
- Optional: Ollama with a model such as `mistral` for local RAG/chat summarization

## Setup

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r engine/requirements.txt
npm install
npm --prefix ui install
```

Add your API key to `.env` only when you use OpenAI-based summarization. Do not commit `.env`.

## Development

Run the desktop app in development mode:

```bash
npm run dev
```

Run backend and UI separately:

```bash
npm run backend:start
npm run frontend:dev
```

The backend health check is available at:

```text
http://127.0.0.1:7861/health
```

## Main API endpoints

- `POST /process` — process a file, YouTube link, document link or web URL.
- `POST /summarize_source` — create a Markdown summary for one processed source.
- `POST /compose_final` — assemble a final Markdown note from source summaries.
- `POST /chat` — ask questions over processed artifacts through local RAG.

## Privacy notes

- Do not commit `.env`, `workspace/`, generated artifacts, virtual environments or build output.
- Runtime files are written locally and are ignored by Git.
- Rotate any API key that was ever committed or shared accidentally.

## License

MIT
