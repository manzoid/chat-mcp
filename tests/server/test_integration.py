"""Integration tests simulating real multi-user scenarios."""

from __future__ import annotations

import uuid

import pytest


@pytest.mark.asyncio
async def test_full_conversation_flow(client):
    """Simulate a full conversation between two humans and an agent."""
    # Register participants
    resp = await client.post("/auth/register", json={"display_name": "alice", "type": "human"})
    alice = resp.json()["participant_id"]
    resp = await client.post("/auth/register", json={"display_name": "bob", "type": "human"})
    bob = resp.json()["participant_id"]
    resp = await client.post("/auth/register", json={
        "display_name": "agent-alice", "type": "agent", "paired_with": alice,
    })
    agent = resp.json()["participant_id"]

    # Create room with all three
    resp = await client.post("/rooms", json={
        "name": f"backend-{uuid.uuid4().hex[:6]}",
        "topic": "Sprint 12",
        "participants": [bob, agent],
    }, headers={"X-Participant-ID": alice})
    room_id = resp.json()["id"]

    # Alice sends a message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "I'm starting on the payment endpoint",
    }, headers={"X-Participant-ID": alice})
    assert resp.status_code == 200
    alice_msg = resp.json()

    # Agent responds
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "I'll set up the route structure and tests first.",
        "thread_id": alice_msg["id"],
    }, headers={"X-Participant-ID": agent})
    assert resp.status_code == 200

    # Bob replies
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Sounds good. I'll handle the webhook receiver.",
    }, headers={"X-Participant-ID": bob})
    assert resp.status_code == 200
    bob_msg = resp.json()

    # Alice reacts to Bob's message
    resp = await client.post(f"/messages/{bob_msg['id']}/reactions", json={
        "emoji": "thumbsup",
    }, headers={"X-Participant-ID": alice})
    assert resp.status_code == 200

    # Agent also reacts
    resp = await client.post(f"/messages/{bob_msg['id']}/reactions", json={
        "emoji": "thumbsup",
    }, headers={"X-Participant-ID": agent})
    assert resp.status_code == 200

    # Verify the full conversation
    resp = await client.get(f"/rooms/{room_id}/messages", headers={"X-Participant-ID": alice})
    messages = resp.json()
    assert len(messages) == 3

    # Verify reactions on bob's message
    resp = await client.get(f"/messages/{bob_msg['id']}", headers={"X-Participant-ID": alice})
    msg = resp.json()
    assert len(msg["reactions"]) == 2

    # Pin the important decision
    resp = await client.post(f"/rooms/{room_id}/messages/pin/{alice_msg['id']}", headers={"X-Participant-ID": alice})
    assert resp.status_code == 200

    # Verify thread
    resp = await client.get(f"/rooms/{room_id}/messages", headers={"X-Participant-ID": alice}, params={
        "thread_id": alice_msg["id"],
    })
    thread = resp.json()
    assert len(thread) == 2  # root + reply


@pytest.mark.asyncio
async def test_multi_room_isolation(client):
    """Messages in one room don't appear in another."""
    resp = await client.post("/auth/register", json={"display_name": "alice"})
    alice = resp.json()["participant_id"]
    headers = {"X-Participant-ID": alice}

    # Create two rooms
    resp = await client.post("/rooms", json={"name": f"room-a-{uuid.uuid4().hex[:6]}"}, headers=headers)
    room_a = resp.json()["id"]
    resp = await client.post("/rooms", json={"name": f"room-b-{uuid.uuid4().hex[:6]}"}, headers=headers)
    room_b = resp.json()["id"]

    # Send to room A
    await client.post(f"/rooms/{room_a}/messages", json={"content_text": "In room A"}, headers=headers)
    await client.post(f"/rooms/{room_a}/messages", json={"content_text": "Also in room A"}, headers=headers)

    # Send to room B
    await client.post(f"/rooms/{room_b}/messages", json={"content_text": "In room B"}, headers=headers)

    # Verify isolation
    resp = await client.get(f"/rooms/{room_a}/messages", headers=headers)
    assert len(resp.json()) == 2
    assert all("room A" in m["content"]["text"] for m in resp.json())

    resp = await client.get(f"/rooms/{room_b}/messages", headers=headers)
    assert len(resp.json()) == 1
    assert resp.json()[0]["content"]["text"] == "In room B"


@pytest.mark.asyncio
async def test_search_across_messages(client, room_and_participant):
    """Search should find messages by content."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "The authentication module uses JWT tokens",
    }, headers=headers)
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Database schema needs migration",
    }, headers=headers)
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Authentication flow needs OAuth support",
    }, headers=headers)

    # Search for authentication
    resp = await client.get(f"/rooms/{room_id}/messages/search", headers=headers, params={
        "q": "authentication",
    })
    results = resp.json()
    assert len(results) == 2

    # Search for database
    resp = await client.get(f"/rooms/{room_id}/messages/search", headers=headers, params={
        "q": "database",
    })
    results = resp.json()
    assert len(results) == 1
    assert "Database" in results[0]["content"]["text"]


@pytest.mark.asyncio
async def test_health_endpoint(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.asyncio
async def test_unauthenticated_request(client):
    """Requests without auth should be rejected."""
    resp = await client.get("/rooms")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_message_with_attachment(client, room_and_participant):
    """Full flow: upload attachment, send message referencing it."""
    import io

    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Upload attachment
    files = {"file": ("schema.sql", io.BytesIO(b"CREATE TABLE test (id INT);"), "text/plain")}
    resp = await client.post(f"/rooms/{room_id}/attachments", headers=headers, files=files)
    assert resp.status_code == 200
    att = resp.json()
    att_id = att["id"]

    # Send message referencing it
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Here's the current schema",
        "attachment_ids": [att_id],
    }, headers=headers)
    assert resp.status_code == 200

    # Verify attachment is linked
    msg_id = resp.json()["id"]
    resp = await client.get(f"/messages/{msg_id}", headers=headers)
    msg = resp.json()
    assert len(msg["attachments"]) == 1
    assert msg["attachments"][0]["filename"] == "schema.sql"


@pytest.mark.asyncio
async def test_thread_summary(client, room_and_participant):
    """Thread summary should show reply count and participants."""
    room_id, pid = room_and_participant
    headers = {"X-Participant-ID": pid}

    # Register bob
    resp = await client.post("/auth/register", json={"display_name": "bob"})
    bob = resp.json()["participant_id"]
    await client.post(f"/rooms/{room_id}/invite", json={"participant_id": bob}, headers=headers)

    # Root message
    resp = await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Design discussion",
    }, headers=headers)
    root_id = resp.json()["id"]

    # Replies from both users
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "I think we should use SSE",
        "thread_id": root_id,
    }, headers=headers)
    await client.post(f"/rooms/{room_id}/messages", json={
        "content_text": "Agreed, SSE is simpler",
        "thread_id": root_id,
    }, headers={"X-Participant-ID": bob})

    # Get thread summary
    resp = await client.get(f"/messages/{root_id}/thread", headers=headers)
    assert resp.status_code == 200
    summary = resp.json()
    assert summary["reply_count"] == 2
    assert pid in summary["participants"]
    assert bob in summary["participants"]
