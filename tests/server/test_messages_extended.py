"""Comprehensive tests for message edge cases."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_empty_message_content(client, room_and_participant):
    """Sending an empty message should still work (protocol allows it)."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "",
        "content_format": "markdown",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["content"]["text"] == ""


@pytest.mark.asyncio
async def test_message_with_mentions(client, room_and_participant):
    """Messages with mentions should store and return them."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Register another user to mention
    resp = await client.post("/auth/register", json={"display_name": "bob"})
    bob_id = resp.json()["participant_id"]

    # Invite bob so mention is valid
    await client.post(f"/rooms/{room_id}/invite", json={"participant_id": bob_id}, headers=headers)

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "@bob what do you think?",
        "mentions": [bob_id],
    }, headers=headers)
    assert resp.status_code == 200
    msg = resp.json()
    assert bob_id in msg["mentions"]


@pytest.mark.asyncio
async def test_get_single_message(client, room_and_participant):
    """GET /messages/:id returns full message with metadata."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Get me by ID",
    }, headers=headers)
    msg_id = resp.json()["id"]

    resp = await client.get(f"/messages/{msg_id}", headers=headers)
    assert resp.status_code == 200
    msg = resp.json()
    assert msg["id"] == msg_id
    assert msg["content"]["text"] == "Get me by ID"
    assert msg["author_id"] == pid
    assert msg["reactions"] == []
    assert msg["attachments"] == []
    assert msg["edit_history"] == []


@pytest.mark.asyncio
async def test_get_nonexistent_message(client, room_and_participant):
    _, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.get("/messages/nonexistent-id", headers=headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_edit_preserves_history(client, room_and_participant):
    """Multiple edits should accumulate edit history."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Version 1",
    }, headers=headers)
    msg_id = resp.json()["id"]

    await client.patch(f"/messages/{msg_id}", json={"content_text": "Version 2"}, headers=headers)
    await client.patch(f"/messages/{msg_id}", json={"content_text": "Version 3"}, headers=headers)

    resp = await client.get(f"/messages/{msg_id}", headers=headers)
    msg = resp.json()
    assert msg["content"]["text"] == "Version 3"
    assert len(msg["edit_history"]) == 2
    assert msg["edit_history"][0]["content"]["text"] == "Version 1"
    assert msg["edit_history"][1]["content"]["text"] == "Version 2"


@pytest.mark.asyncio
async def test_cannot_edit_other_users_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Alice's message",
    }, headers=headers)
    msg_id = resp.json()["id"]

    # Register bob and add to room
    resp = await client.post("/auth/register", json={"display_name": "bob"})
    bob_id = resp.json()["participant_id"]
    await client.post(f"/rooms/{room_id}/invite", json={"participant_id": bob_id}, headers=headers)

    # Bob tries to edit Alice's message
    resp = await client.patch(f"/messages/{msg_id}", json={
        "content_text": "Bob hijacked this",
    }, headers={"X-Participant-ID": bob_id})
    assert resp.status_code == 404  # Not found = not yours


@pytest.mark.asyncio
async def test_cannot_delete_other_users_message(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Alice's message",
    }, headers=headers)
    msg_id = resp.json()["id"]

    resp = await client.post("/auth/register", json={"display_name": "charlie"})
    charlie_id = resp.json()["participant_id"]
    await client.post(f"/rooms/{room_id}/invite", json={"participant_id": charlie_id}, headers=headers)

    resp = await client.delete(f"/messages/{msg_id}", headers={"X-Participant-ID": charlie_id})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_deleted_messages_not_in_listing(client, room_and_participant):
    """Deleted messages should not appear in GET /rooms/:id/messages."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={"content_text": "Keep me"}, headers=headers)
    resp = await client.post(f"/rooms/{room_id}/messages", json={"content_text": "Delete me"}, headers=headers)
    delete_id = resp.json()["id"]
    resp = await client.post(f"/rooms/{room_id}/messages", json={"content_text": "Also keep me"}, headers=headers)

    await client.delete(f"/messages/{delete_id}", headers=headers)

    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers)
    messages = resp.json()
    assert len(messages) == 2
    texts = [m["content"]["text"] for m in messages]
    assert "Delete me" not in texts
    assert "Keep me" in texts
    assert "Also keep me" in texts


@pytest.mark.asyncio
async def test_plain_text_format(client, room_and_participant):
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "No markdown here",
        "content_format": "plain",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["content"]["format"] == "plain"


@pytest.mark.asyncio
async def test_message_pagination_limit(client, room_and_participant):
    """Test pagination with limit parameter."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    for i in range(10):
        await client.post(f"/rooms/{room_id}/messages", json={
            "content_text": f"Msg {i}",
        }, headers=headers)

    # Get only 3 messages
    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers, params={"limit": 3})
    messages = resp.json()
    assert len(messages) == 3

    # Get all messages
    resp = await client.get(f"/rooms/{room_id}/messages", headers=headers, params={"limit": 50})
    messages = resp.json()
    assert len(messages) == 10
