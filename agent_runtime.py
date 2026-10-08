"""Lazy runtime for the marketing outreach deep agent.

The web layer (server.py) imports this module, but the heavy LLM/search
dependencies are only touched when an agent is actually requested. That keeps
the HTTP server bootable (and the UI reachable) even when API keys or the LLM
packages are missing, and lets /api/health report exactly what is absent.
"""

from __future__ import annotations

import os
import threading
from typing import Any, Dict, Iterator, List, Optional, Tuple

DEFAULT_MODEL = "gemini-3.5-flash-lite"

# Environment variables the agent needs at runtime.
REQUIRED_ENV = (
    "GOOGLE_API_KEY",
    "TAVILY_API_KEY",
    "SMTP_SERVER",
    "SMTP_PORT",
    "APP_PASSWORD",
    "USER_ADD",
)

_AGENT: Optional[Any] = None
_AGENT_ERROR: Optional[str] = None
_AGENT_LOCK = threading.Lock()


def model_name() -> str:
    return os.getenv("MODEL_NAME", DEFAULT_MODEL)


def missing_env() -> List[str]:
    return [name for name in REQUIRED_ENV if not os.getenv(name)]


def _build_agent() -> Tuple[Any, Optional[str]]:
    """Build the deep agent. Returns (agent, error)."""
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from deepagents import create_deep_agent
        from deepagents.backends import StateBackend
        from langgraph.checkpoint.memory import MemorySaver

        from tools.email_sender import send_email
        from tools.google_search import search_page, search_web
        from prompts.prompts import main_agent
    except Exception as exc:  # dependency or import problem
        return None, f"Could not import agent dependencies: {exc}"

    try:
        model = ChatGoogleGenerativeAI(
            model=model_name(), api_key=os.getenv("GOOGLE_API_KEY")
        )
        agent = create_deep_agent(
            model=model,
            tools=[send_email, search_page, search_web],
            system_prompt=main_agent,
            skills=["/skills"],
            memory=["/memories/Agent.md"],
            backend=StateBackend(),
            checkpointer=MemorySaver(),
        )
    except Exception as exc:
        return None, f"Could not create the agent: {exc}"
    return agent, None


def get_agent() -> Tuple[Any, Optional[str]]:
    """Return the cached agent (building it once) as (agent, error)."""
    global _AGENT, _AGENT_ERROR
    with _AGENT_LOCK:
        if _AGENT is None and _AGENT_ERROR is None:
            _AGENT, _AGENT_ERROR = _build_agent()
        return _AGENT, _AGENT_ERROR


def reset_agent() -> None:
    """Drop the cached agent so the next request rebuilds it."""
    global _AGENT, _AGENT_ERROR
    with _AGENT_LOCK:
        _AGENT = None
        _AGENT_ERROR = None


def status() -> Dict[str, Any]:
    agent, error = get_agent()
    return {
        "ready": agent is not None,
        "error": error,
        "model": model_name(),
        "missing_env": missing_env(),
    }


# --------------------------------------------------------------------------- #
# Streaming helpers
# --------------------------------------------------------------------------- #

def _content_to_text(content: Any) -> str:
    """Flatten a LangChain message content (str or list of blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, dict):
                parts.append(block.get("text") or block.get("content") or "")
            elif isinstance(block, str):
                parts.append(block)
        return "".join(p for p in parts if p)
    if content is None:
        return ""
    return str(content)


def _tool_calls(message: Any) -> List[Dict[str, Any]]:
    calls = getattr(message, "tool_calls", None) or []
    out: List[Dict[str, Any]] = []
    for call in calls:
        if isinstance(call, dict):
            out.append({"name": call.get("name", "tool"), "args": call.get("args", {})})
    return out


def _is_tool_message(message: Any) -> bool:
    return type(message).__name__ == "ToolMessage" or hasattr(message, "tool_call_id")


def _summarize_args(args: Any) -> str:
    """Pull the most useful value out of a tool call's arguments for display."""
    if isinstance(args, dict):
        for key in ("query", "page_urls", "urls", "recepient", "recipient", "subject"):
            if key in args:
                value = args[key]
                if isinstance(value, (list, tuple)):
                    return ", ".join(str(v) for v in value)[:160]
                return str(value)[:160]
        if args:
            return str(next(iter(args.values())))[:160]
    return ""


def stream_events(message: str, thread_id: str) -> Iterator[Dict[str, Any]]:
    """Run the agent and yield UI-ready events as they happen.

    Event shapes:
      {"type": "tool",   "name": str, "detail": str, "status": "running"|"done"}
      {"type": "answer", "text": str}
      {"type": "error",  "message": str}
    """
    agent, error = get_agent()
    if agent is None:
        hint = error or "Agent is not available."
        missing = missing_env()
        if missing:
            hint += " Missing environment variables: " + ", ".join(missing) + "."
        yield {"type": "error", "message": hint}
        return

    config = {"configurable": {"thread_id": thread_id}}
    payload = {"messages": [{"role": "user", "content": message}]}

    try:
        stream = agent.stream(payload, config=config, stream_mode="updates")
    except TypeError:
        stream = None
    except Exception as exc:
        yield {"type": "error", "message": f"Agent failed to start: {exc}"}
        return

    if stream is None:
        # Agent without .stream support: fall back to a single blocking call.
        try:
            result = agent.invoke(payload, config=config)
            text = _content_to_text(result["messages"][-1].content)
        except Exception as exc:
            yield {"type": "error", "message": f"Agent failed: {exc}"}
            return
        yield {"type": "answer", "text": text}
        return

    final_text = ""
    try:
        for chunk in stream:
            if not isinstance(chunk, dict):
                continue
            for _node, update in chunk.items():
                messages = update.get("messages") if isinstance(update, dict) else None
                if not messages:
                    continue
                for m in messages:
                    calls = _tool_calls(m)
                    for call in calls:
                        yield {
                            "type": "tool",
                            "name": call["name"],
                            "detail": _summarize_args(call.get("args")),
                            "status": "running",
                        }
                    if _is_tool_message(m):
                        yield {
                            "type": "tool",
                            "name": getattr(m, "name", "") or "tool",
                            "detail": _content_to_text(getattr(m, "content", ""))[:240],
                            "status": "done",
                        }
                        continue
                    text = _content_to_text(getattr(m, "content", ""))
                    if text and not calls:
                        final_text = text
    except Exception as exc:
        yield {"type": "error", "message": f"Agent failed mid-run: {exc}"}
        return

    yield {"type": "answer", "text": final_text or "No response was produced."}
