"""Canonical JSON construction and payload building for message signing."""

from __future__ import annotations

import hashlib
import json
from typing import Optional


def canonical_json(obj: dict) -> str:
    """Produce deterministic JSON for signing. No floats allowed in signed payloads."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def build_message_payload(
    room_id: str,
    content_format: str,
    content_text: str,
    thread_id: Optional[str],
    mentions: list[str],
    attachment_ids: list[str],
    timestamp: str,
) -> str:
    """Build the canonical payload for message signing."""
    payload = {
        "room_id": room_id,
        "content": {"format": content_format, "text": content_text},
        "thread_id": thread_id,
        "mentions": sorted(mentions),
        "attachments": sorted(attachment_ids),
        "timestamp": timestamp,
    }
    return canonical_json(payload)


def build_reaction_payload(message_id: str, emoji: str, author_id: str) -> str:
    """Build the canonical payload for reaction signing."""
    payload = {
        "message_id": message_id,
        "emoji": emoji,
        "author_id": author_id,
    }
    return canonical_json(payload)


def hash_payload(payload: str) -> bytes:
    """SHA-256 hash of a canonical JSON payload."""
    return hashlib.sha256(payload.encode("utf-8")).digest()
