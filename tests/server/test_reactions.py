"""Tests for reaction endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_add_and_remove_reaction(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "React to me",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Add reaction
    resp = await client.post(f"/messages/{msg_id}/reactions", json={
        "emoji": "thumbsup",
    }, headers=headers)
    assert resp.status_code == 200

    # Verify reaction on message
    resp = await client.get(f"/messages/{msg_id}", headers=headers)
    reactions = resp.json()["reactions"]
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "thumbsup"

    # Remove reaction
    resp = await client.delete(f"/messages/{msg_id}/reactions/thumbsup", headers=headers)
    assert resp.status_code == 200

    # Verify removed
    resp = await client.get(f"/messages/{msg_id}", headers=headers)
    assert len(resp.json()["reactions"]) == 0


@pytest.mark.asyncio
async def test_duplicate_reaction(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "React to me",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # First reaction
    resp = await client.post(f"/messages/{msg_id}/reactions", json={"emoji": "heart"}, headers=headers)
    assert resp.status_code == 200

    # Duplicate should fail
    resp = await client.post(f"/messages/{msg_id}/reactions", json={"emoji": "heart"}, headers=headers)
    assert resp.status_code == 400
