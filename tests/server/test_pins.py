"""Tests for pin functionality."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_pin_and_list_pins(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Pin this important decision",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Pin it
    resp = await client.post(f"/rooms/{room_id}/messages/pin/{msg_id}", headers=headers)
    assert resp.status_code == 200

    # List pins
    resp = await client.get(f"/rooms/{room_id}/pins", headers=headers)
    assert resp.status_code == 200
    pins = resp.json()
    assert len(pins) == 1
    assert pins[0]["id"] == msg_id
    assert pins[0]["content"]["text"] == "Pin this important decision"


@pytest.mark.asyncio
async def test_unpin_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Temporary pin",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Pin then unpin
    await client.post(f"/rooms/{room_id}/messages/pin/{msg_id}", headers=headers)
    resp = await client.delete(f"/rooms/{room_id}/messages/pin/{msg_id}", headers=headers)
    assert resp.status_code == 200

    resp = await client.get(f"/rooms/{room_id}/pins", headers=headers)
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_pin_appears_in_room_details(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Architecture decision: use SQLite",
    }, headers=headers)
    msg_id = resp.json()["id"]

    await client.post(f"/rooms/{room_id}/messages/pin/{msg_id}", headers=headers)

    resp = await client.get(f"/rooms/{room_id}", headers=headers)
    room = resp.json()
    assert msg_id in room["pinned"]


@pytest.mark.asyncio
async def test_multiple_pins(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    msg_ids = []
    for i in range(3):
        resp = await client.post(f"/rooms/{room_id}/messages", json={
            "content_text": f"Decision {i}",
        }, headers=headers)
        msg_ids.append(resp.json()["id"])

    for mid in msg_ids:
        await client.post(f"/rooms/{room_id}/messages/pin/{mid}", headers=headers)

    resp = await client.get(f"/rooms/{room_id}/pins", headers=headers)
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_non_participant_cannot_pin(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Pin me",
    }, headers=headers)
    msg_id = resp.json()["id"]

    resp = await client.post("/auth/register", json={"display_name": "outsider"})
    outsider_id = resp.json()["participant_id"]

    resp = await client.post(
        f"/rooms/{room_id}/messages/pin/{msg_id}",
        headers={"X-Participant-ID": outsider_id},
    )
    assert resp.status_code == 403
