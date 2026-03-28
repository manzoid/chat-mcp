"""Extended agent filter tests."""

from __future__ import annotations

import pytest

from chat_mcp.agent.config import AgentConfig
from chat_mcp.agent.filters import is_relevant


def make_event(etype: str = "message.created", **payload_kwargs) -> dict:
    default_payload = {
        "author_id": "other-user",
        "content": {"text": "hello", "format": "markdown"},
        "mentions": [],
    }
    default_payload.update(payload_kwargs)
    return {"type": etype, "payload": default_payload}


def test_case_insensitive_keywords():
    config = AgentConfig(participant_id="agent-1", keywords=["URGENT"])
    event = make_event(content={"text": "this is urgent!", "format": "markdown"})
    assert is_relevant(event, config) is True


def test_multiple_keywords_any_match():
    config = AgentConfig(participant_id="agent-1", keywords=["deploy", "rollback", "outage"])
    event = make_event(content={"text": "We need to rollback the change", "format": "markdown"})
    assert is_relevant(event, config) is True


def test_keyword_partial_match():
    config = AgentConfig(participant_id="agent-1", keywords=["auth"])
    event = make_event(content={"text": "The authentication module works", "format": "markdown"})
    assert is_relevant(event, config) is True  # "auth" is in "authentication"


def test_reaction_events_always_relevant():
    config = AgentConfig(participant_id="agent-1")
    event = {"type": "reaction.added", "payload": {"message_id": "msg-1"}}
    assert is_relevant(event, config) is True


def test_message_deleted_events():
    config = AgentConfig(participant_id="agent-1")
    event = {"type": "message.deleted", "payload": {"message_id": "msg-1"}}
    assert is_relevant(event, config) is True  # delete events have no author, should pass through


def test_empty_mentions_list():
    config = AgentConfig(participant_id="agent-1", mention_me=True)
    event = make_event(mentions=[])
    assert is_relevant(event, config) is False


def test_both_mention_filters():
    """When both mention filters are on, either should trigger."""
    config = AgentConfig(participant_id="agent-1", mention_me=True, mention_paired_human=True)

    # Mentioned directly
    event = make_event(mentions=["agent-1"])
    assert is_relevant(event, config) is True

    # Paired human mentioned
    event = make_event(mentions=["human-1"])
    assert is_relevant(event, config, paired_human_id="human-1") is True

    # Neither mentioned
    event = make_event(mentions=["someone-else"])
    assert is_relevant(event, config, paired_human_id="human-1") is False


def test_config_from_defaults():
    config = AgentConfig()
    assert config.reconnect_delay_seconds == 5
    assert config.periodic_checkin_minutes == 30
    assert config.max_context_messages == 20
    assert config.max_messages_per_minute == 10
    assert config.watch_rooms == ["all"]
