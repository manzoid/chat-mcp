"""Tests for agent event filters."""

from __future__ import annotations

import pytest

from chat_mcp.agent.config import AgentConfig
from chat_mcp.agent.filters import is_relevant


def make_message_event(text: str = "hello", author_id: str = "other", mentions: list[str] | None = None) -> dict:
    return {
        "type": "message.created",
        "payload": {
            "author_id": author_id,
            "content": {"text": text, "format": "markdown"},
            "mentions": mentions or [],
        },
    }


def test_all_messages_filter():
    config = AgentConfig(participant_id="agent-1", all_messages=True)
    event = make_message_event()
    assert is_relevant(event, config) is True


def test_mention_me_filter():
    config = AgentConfig(participant_id="agent-1", mention_me=True)
    event = make_message_event(mentions=["agent-1"])
    assert is_relevant(event, config) is True


def test_mention_me_not_mentioned():
    config = AgentConfig(participant_id="agent-1", mention_me=True)
    event = make_message_event(mentions=["other-user"])
    assert is_relevant(event, config) is False


def test_mention_paired_human():
    config = AgentConfig(participant_id="agent-1", mention_paired_human=True)
    event = make_message_event(mentions=["human-1"])
    assert is_relevant(event, config, paired_human_id="human-1") is True


def test_keyword_filter():
    config = AgentConfig(participant_id="agent-1", keywords=["urgent", "CI failed"])
    event = make_message_event(text="CI failed on main branch")
    assert is_relevant(event, config) is True


def test_keyword_no_match():
    config = AgentConfig(participant_id="agent-1", keywords=["urgent"])
    event = make_message_event(text="Everything is fine")
    assert is_relevant(event, config) is False


def test_ignore_own_messages():
    config = AgentConfig(participant_id="agent-1", all_messages=True)
    event = make_message_event(author_id="agent-1")
    assert is_relevant(event, config) is False


def test_non_message_events_always_relevant():
    config = AgentConfig(participant_id="agent-1")
    event = {"type": "participant.joined", "payload": {"participant_id": "someone"}}
    assert is_relevant(event, config) is True
