"""Tests for agent runner components."""

from __future__ import annotations

import pytest

from chat_mcp.agent.config import AgentConfig
from chat_mcp.agent.invoker import build_prompt


def test_build_prompt_includes_context():
    event = {
        "type": "message.created",
        "payload": {
            "author_id": "user-1",
            "content": {"text": "What's the status?", "format": "markdown"},
        },
    }
    recent = [
        {"author_id": "user-1", "content": {"text": "Starting work", "format": "markdown"}},
        {"author_id": "agent-1", "content": {"text": "Working on auth", "format": "markdown"}},
    ]
    config = AgentConfig(max_context_messages=20)

    prompt = build_prompt(event, recent, config)

    assert "Starting work" in prompt
    assert "Working on auth" in prompt
    assert "What's the status?" in prompt
    assert "message.created" in prompt


def test_build_prompt_limits_context():
    config = AgentConfig(max_context_messages=2)
    recent = [
        {"author_id": f"user-{i}", "content": {"text": f"msg {i}"}}
        for i in range(10)
    ]
    event = {"type": "message.created", "payload": {}}

    prompt = build_prompt(event, recent, config)

    # Should only include last 2 messages
    assert "msg 8" in prompt
    assert "msg 9" in prompt
    assert "msg 0" not in prompt


def test_agent_config_defaults():
    config = AgentConfig()
    assert config.mention_me is True
    assert config.claude_command == "claude"
    assert "-p" in config.claude_flags
    assert config.max_messages_per_minute == 10
