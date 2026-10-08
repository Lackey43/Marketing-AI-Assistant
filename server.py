"""FastAPI web server for the Marketing Outreach Studio.

Replaces the Streamlit UI with a static single-page app plus a small JSON / SSE
API. The agent work runs in a threadpool (sync endpoint + sync generator), so a
slow research run never blocks the event loop.

Run:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import agent_runtime

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Marketing Outreach Studio", docs_url="/api/docs", redoc_url=None)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health() -> dict:
    info = agent_runtime.status()
    return {
        "status": "ok",
        "model": info["model"],
        "ready": info["ready"],
        "agent_error": info["error"],
        "missing_env": info["missing_env"],
    }


@app.get("/api/agent/status")
def agent_status() -> dict:
    return agent_runtime.status()


@app.post("/api/agent/reset")
def agent_reset() -> dict:
    agent_runtime.reset_agent()
    return {"status": "reset"}


@app.post("/api/chat")
def chat(payload: ChatRequest):
    message = payload.message.strip()
    if not message:
        return JSONResponse({"error": "message must not be empty"}, status_code=400)

    thread_id = payload.session_id.strip() or "default"

    def event_stream():
        try:
            for event in agent_runtime.stream_events(message, thread_id):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # never let the stream break silently
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
