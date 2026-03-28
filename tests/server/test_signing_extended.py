"""Extended signing and security tests."""

from __future__ import annotations

import json

import pytest

from chat_mcp.shared.signing import canonical_json, build_message_payload, hash_payload


def test_canonical_json_nested_objects():
    """Nested objects should also have sorted keys."""
    obj = {"b": {"z": 1, "a": 2}, "a": 3}
    result = canonical_json(obj)
    parsed = json.loads(result)
    assert list(parsed.keys()) == ["a", "b"]
    assert list(parsed["b"].keys()) == ["a", "z"]


def test_canonical_json_unicode():
    """Unicode characters should be preserved, not escaped."""
    obj = {"emoji": "thumbsup", "text": "caf\u00e9"}
    result = canonical_json(obj)
    assert "caf\u00e9" in result


def test_canonical_json_null_values():
    obj = {"key": None, "other": "value"}
    result = canonical_json(obj)
    assert "null" in result


def test_canonical_json_empty_arrays():
    obj = {"items": [], "count": 0}
    result = canonical_json(obj)
    assert "[]" in result


def test_canonical_json_integers():
    obj = {"count": 42, "negative": -1, "zero": 0}
    result = canonical_json(obj)
    assert '"count":42' in result


def test_message_payload_consistency():
    """Same inputs always produce the same payload."""
    kwargs = {
        "room_id": "room-1",
        "content_format": "markdown",
        "content_text": "hello world",
        "thread_id": None,
        "mentions": ["bob", "alice"],
        "attachment_ids": ["att-2", "att-1"],
        "timestamp": "2024-01-01T00:00:00Z",
    }
    p1 = build_message_payload(**kwargs)
    p2 = build_message_payload(**kwargs)
    assert p1 == p2

    # Mentions and attachments should be sorted
    parsed = json.loads(p1)
    assert parsed["mentions"] == ["alice", "bob"]
    assert parsed["attachments"] == ["att-1", "att-2"]


def test_hash_consistency():
    """Same payload always produces same hash."""
    payload = '{"test":"data"}'
    h1 = hash_payload(payload)
    h2 = hash_payload(payload)
    assert h1 == h2


def test_different_payloads_different_hashes():
    h1 = hash_payload('{"a":1}')
    h2 = hash_payload('{"a":2}')
    assert h1 != h2
