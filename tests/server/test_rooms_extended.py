"""Comprehensive tests for room edge cases."""

from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_room_with_topic(client):
    resp = await client.post("/auth/register", json={"display_name": "alice"})
    pid = resp.json()["participant_id"]
    headers = {"X-Participant-ID": pid}

    resp = await client.post("/rooms", json={
        "name": f"backend-{uuid.uuid4().hex[:8]}",
        "topic": "Sprint 12 backend work",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["topic"] == "Sprint 12 backend work"


@pytest.mark.asyncio
async def test_room_with_initial_participants(client):
    resp = await client.post("/auth/register", json={"display_name": "alice"})
    alice_id = resp.json()["participant_id"]
    resp = await client.post("/auth/register", json={"display_name": "bob"})
    bob_id = resp.json()["participant_id"]

    resp = await client.post("/rooms", json={
        "name": f"team-{uuid.uuid4().hex[:8]}",
        "participants": [bob_id],
    }, headers={"X-Participant-ID": alice_id})
    assert resp.status_code == 200
    room = resp.json()
    assert alice_id in room["participants"]
    assert bob_id in room["participants"]


@pytest.mark.asyncio
async def test_duplicate_room_name(client):
    resp = await client.post("/auth/register", json={"display_name": "alice"})
    pid = resp.json()["participant_id"]
    headers = {"X-Participant-ID": pid}

    name = f"unique-{uuid.uuid4().hex[:8]}"
    resp = await client.post("/rooms", json={"name": name}, headers=headers)
    assert resp.status_code == 200

    # Duplicate name should fail
    resp = await client.post("/rooms", json={"name": name}, headers=headers)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_leave_and_rejoin(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Leave
    resp = await client.post(f"/rooms/{room_id}/leave", headers=headers)
    assert resp.status_code == 200

    # Should not see room in list
    resp = await client.get("/rooms", headers=headers)
    assert not any(r["id"] == room_id for r in resp.json())

    # Rejoin
    resp = await client.post(f"/rooms/{room_id}/join", headers=headers)
    assert resp.status_code == 200

    # Should see room again
    resp = await client.get("/rooms", headers=headers)
    assert any(r["id"] == room_id for r in resp.json())


@pytest.mark.asyncio
async def test_outsider_cannot_invite(client, room_and_participant):
    """Only room participants can invite others."""
    room_id, _ = room_and_participant

    resp = await client.post("/auth/register", json={"display_name": "outsider"})
    outsider_id = resp.json()["participant_id"]
    resp = await client.post("/auth/register", json={"display_name": "target"})
    target_id = resp.json()["participant_id"]

    resp = await client.post(f"/rooms/{room_id}/invite", json={
        "participant_id": target_id,
    }, headers={"X-Participant-ID": outsider_id})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_room_details(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.get(f"/rooms/{room_id}", headers=headers)
    assert resp.status_code == 200
    room = resp.json()
    assert room["id"] == room_id
    assert pid in room["participants"]
    assert "created_at" in room


@pytest.mark.asyncio
async def test_get_participants(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.get(f"/rooms/{room_id}/participants", headers=headers)
    assert resp.status_code == 200
    participants = resp.json()
    assert len(participants) >= 1
    assert any(p["id"] == pid for p in participants)
    # Verify participant has expected fields
    p = participants[0]
    assert "display_name" in p
    assert "type" in p
    assert "status" in p
