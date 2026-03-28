"""Tests for participant and presence endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_set_status_online(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post("/participants/me/status", json={
        "state": "online",
    }, headers=headers)
    assert resp.status_code == 200

    # Verify via participants list
    resp = await client.get(f"/rooms/{room_id}/participants", headers=headers)
    participants = resp.json()
    me = next(p for p in participants if p["id"] == pid)
    assert me["status"]["state"] == "online"


@pytest.mark.asyncio
async def test_set_status_with_description(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post("/participants/me/status", json={
        "state": "busy",
        "description": "working on auth.py",
    }, headers=headers)
    assert resp.status_code == 200

    resp = await client.get(f"/rooms/{room_id}/participants", headers=headers)
    me = next(p for p in resp.json() if p["id"] == pid)
    assert me["status"]["state"] == "busy"
    assert me["status"]["description"] == "working on auth.py"


@pytest.mark.asyncio
async def test_set_status_away(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post("/participants/me/status", json={
        "state": "away",
    }, headers=headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_typing_indicator(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/typing", json={
        "is_typing": True,
    }, headers=headers)
    assert resp.status_code == 200

    resp = await client.post(f"/rooms/{room_id}/typing", json={
        "is_typing": False,
    }, headers=headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_agent_participant(client):
    """Agent participants have correct type and pairing."""
    # Register human
    resp = await client.post("/auth/register", json={
        "display_name": "alice",
        "type": "human",
    })
    alice_id = resp.json()["participant_id"]

    # Register agent
    resp = await client.post("/auth/register", json={
        "display_name": "agent-alice",
        "type": "agent",
        "paired_with": alice_id,
    })
    agent_id = resp.json()["participant_id"]

    # Create room with both
    resp = await client.post("/rooms", json={
        "name": "test-agent-room",
        "participants": [agent_id],
    }, headers={"X-Participant-ID": alice_id})
    room_id = resp.json()["id"]

    # Check participants
    resp = await client.get(f"/rooms/{room_id}/participants", headers={"X-Participant-ID": alice_id})
    participants = resp.json()
    agent = next(p for p in participants if p["id"] == agent_id)
    assert agent["type"] == "agent"
    assert agent["paired_with"] == alice_id
