"""Tests for message endpoints."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_send_and_read_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Hello, world!",
        "content_format": "markdown",
    }, headers=headers)
    assert resp.status_code == 200
    msg = resp.json()
    assert msg["content"]["text"] == "Hello, world!"
    assert msg["author_id"] == pid
    assert msg["room_id"] == room_id

    # Read messages
    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers)
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 1
    assert messages[0]["content"]["text"] == "Hello, world!"


@pytest.mark.asyncio
async def test_send_multiple_messages(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    for i in range(5):
        resp = await client.post(f"/rooms/{room_id}/messages", json={
            "content_text": f"Message {i}",
        }, headers=headers)
        assert resp.status_code == 200

    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers, params={"limit": 3})
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 3


@pytest.mark.asyncio
async def test_thread_messages(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send root message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Root message",
    }, headers=headers)
    root_id = resp.json()["id"]

    # Send thread reply
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Thread reply",
        "thread_id": root_id,
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["thread_id"] == root_id

    # Get thread
    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers, params={"thread_id": root_id})
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 2


@pytest.mark.asyncio
async def test_edit_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Original",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Edit
    resp = await client.patch(f"/messages/{msg_id}", json={
        "content_text": "Edited",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["content"]["text"] == "Edited"
    assert resp.json()["edited_at"] is not None
    assert len(resp.json()["edit_history"]) == 1


@pytest.mark.asyncio
async def test_delete_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Send
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "To delete",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Delete
    resp = await client.delete(f"/messages/{msg_id}", headers=headers)
    assert resp.status_code == 200

    # Should not appear in listing
    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers)
    assert len(resp.json()) == 0


@pytest.mark.asyncio
async def test_non_participant_cannot_send(client, room_and_participant):
    room_id, pid = room_and_participant

    # Register another user
    resp = await client.post("/auth/register", json={"display_name": "outsider"})
    outsider_id = resp.json()["participant_id"]

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "I shouldn't be able to send this",
    }, headers={"X-Participant-ID": outsider_id})
    assert resp.status_code == 403
