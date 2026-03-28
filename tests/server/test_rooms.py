"""Tests for room endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_create_room(client):
    # Register
    resp = await client.post("/auth/register", json={"display_name": "alice"})
    pid = resp.json()["participant_id"]
    headers = {"X-Participant-ID": pid}

    # Create room
    resp = await client.post("/rooms", json={"name": "backend"}, headers=headers)
    assert resp.status_code == 200
    room = resp.json()
    assert room["name"] == "backend"
    assert pid in room["participants"]


@pytest.mark.asyncio
async def test_list_rooms(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.get("/rooms", headers=headers)
    assert resp.status_code == 200
    rooms = resp.json()
    assert any(r["id"] == room_id for r in rooms)


@pytest.mark.asyncio
async def test_room_invite_and_kick(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Register bob
    resp = await client.post("/auth/register", json={"display_name": "bob"})
    bob_id = resp.json()["participant_id"]

    # Invite bob
    resp = await client.post(f"/rooms/{room_id}/invite", json={
        "participant_id": bob_id,
    }, headers=headers)
    assert resp.status_code == 200

    # Verify bob is in room
    resp = await client.get(f"/rooms/{room_id}", headers=headers)
    assert bob_id in resp.json()["participants"]

    # Kick bob
    resp = await client.post(f"/rooms/{room_id}/kick", json={
        "participant_id": bob_id,
    }, headers=headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_set_topic(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.put(f"/rooms/{room_id}/topic", json={
        "topic": "Sprint 12 work",
    }, headers=headers)
    assert resp.status_code == 200

    resp = await client.get(f"/rooms/{room_id}", headers=headers)
    assert resp.json()["topic"] == "Sprint 12 work"


@pytest.mark.asyncio
async def test_non_participant_cannot_view_room(client, room_and_participant):
    room_id, _ = room_and_participant

    resp = await client.post("/auth/register", json={"display_name": "outsider"})
    outsider_id = resp.json()["participant_id"]

    resp = await client.get(f"/rooms/{room_id}", headers={"X-Participant-ID": outsider_id})
    assert resp.status_code == 403
