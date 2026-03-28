"""Tests for signing utilities."""

from __future__ import annotations

import json

import pytest

from chat_mcp.shared.signing import canonical_json, build_message_payload, build_reaction_payload, hash_payload


def test_canonical_json_sorted_keys():
    obj = {"b": 2, "a": 1, "c": 3}
    result = canonical_json(obj)
    assert result == '{"a":1,"b":2,"c":3}'


def test_canonical_json_no_spaces():
    obj = {"key": "value", "list": [1, 2, 3]}
    result = canonical_json(obj)
    assert " " not in result.replace('"key"', "").replace('"value"', "").replace('"list"', "")


def test_canonical_json_deterministic():
    obj = {"z": 1, "a": 2, "m": 3}
    assert canonical_json(obj) == canonical_json(obj)


def test_build_message_payload():
    payload = build_message_payload(
        room_id="room-1",
        content_format="markdown",
        content_text="hello",
        thread_id=None,
        mentions=["bob", "alice"],
        attachment_ids=[],
        timestamp="2024-01-01T00:00:00Z",
    )
    parsed = json.loads(payload)
    assert parsed["room_id"] == "room-1"
    assert parsed["mentions"] == ["alice", "bob"]  # Sorted
    assert parsed["thread_id"] is None


def test_build_reaction_payload():
    payload = build_reaction_payload("msg-1", "thumbsup", "user-1")
    parsed = json.loads(payload)
    assert parsed["message_id"] == "msg-1"
    assert parsed["emoji"] == "thumbsup"
    assert parsed["author_id"] == "user-1"


def test_hash_payload():
    payload = '{"test":"data"}'
    h = hash_payload(payload)
    assert len(h) == 32  # SHA-256 = 32 bytes
    # Same input produces same hash
    assert hash_payload(payload) == h
