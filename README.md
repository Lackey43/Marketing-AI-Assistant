# Marketing Outreach Studio

A deep-agent app that researches a business and drafts (and can send) a
personalized outreach email. The UI is now a FastAPI app plus a static
single-page front end. Streamlit is no longer used.

## Files

- `server.py` - FastAPI server. Replaces the old Streamlit entrypoint.
- `agent_runtime.py` - builds the deep agent lazily and streams its steps.
- `static/index.html`, `static/styles.css`, `static/app.js` - the page.
- `prompts/`, `tools/` - unchanged agent prompt and tools.

## Environment

Create a `.env` in the project root:

```
GOOGLE_API_KEY=...
TAVILY_API_KEY=...
SMTP_SERVER=...
SMTP_PORT=...
APP_PASSWORD=...
USER_ADD=...
```

Optional: `MODEL_NAME` (defaults to `gemini-3.5-flash-lite`).

The agent is built lazily, so the server and the page load fine before keys are
set. The status dot in the left rail reports "Awaiting API keys" until they are.

## Run locally

```
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # Linux/macOS
uvicorn server:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000

## Deploy

`Procfile`:

```
web: uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}
```

Set the same environment variables on the host. If you front it with nginx, make
sure the `/api/chat` SSE stream is not buffered. The response already sends
`X-Accel-Buffering: no`, but you may also want `proxy_buffering off;` and a long
`proxy_read_timeout` for slow research runs.

## API

- `GET /api/health` - status, model name, missing env vars.
- `GET /api/agent/status` - agent readiness and last build error.
- `POST /api/chat` - body `{ "message": str, "session_id": str }`, returns a
  `text/event-stream` of `tool` / `answer` / `error` / `done` events.
- `POST /api/agent/reset` - drop the cached agent so the next request rebuilds it.
