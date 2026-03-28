"""Invoke Claude CLI to process events and act on them."""

from __future__ import annotations

import json
import subprocess
from typing import Optional

from chat_mcp.agent.config import AgentConfig


def build_prompt(event: dict, recent_messages: list[dict], config: AgentConfig) -> str:
    """Build a prompt for Claude from an event and recent context."""
    lines = [
        "You are an AI agent participating in a collaborative chat.",
        "You should respond helpfully to messages directed at you or your human.",
        "Keep responses concise and relevant.",
        "",
        "## Recent Chat Context",
        "",
    ]

    for msg in recent_messages[-config.max_context_messages:]:
        content = msg.get("content", {})
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        author = msg.get("author_id", "unknown")[:8]
        lines.append(f"[{author}]: {text}")

    lines.extend([
        "",
        "## Current Event",
        "",
        f"Type: {event.get('type', 'unknown')}",
        f"Payload: {json.dumps(event.get('payload', {}), indent=2)}",
        "",
        "## Instructions",
        "",
        "Respond to this event if appropriate. If you want to send a message, "
        "output it directly. If no response is needed, output: [NO_ACTION]",
    ])

    return "\n".join(lines)


def invoke_claude(prompt: str, config: AgentConfig) -> Optional[str]:
    """Invoke Claude CLI and return the response."""
    cmd = [config.claude_command] + config.claude_flags

    try:
        proc = subprocess.run(
            cmd,
            input=prompt,
            capture_output=True,
            text=True,
            timeout=120,
        )

        if proc.returncode != 0:
            return None

        response = proc.stdout.strip()
        if response == "[NO_ACTION]" or not response:
            return None

        return response

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
