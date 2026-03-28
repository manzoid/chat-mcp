"""Tests for search functionality."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_search_messages(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send messages
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "The caching strategy needs work",
    }, headers=headers)
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Payment processing is done",
    }, headers=headers)
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Let's discuss the caching layer tomorrow",
    }, headers=headers)

    # Search for caching
    resp = await client.get(f"/rooms/{room_id}/messages/search", headers=headers, params={"q": "caching"})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 2
    for msg in results:
        assert "caching" in msg["content"]["text"].lower()
