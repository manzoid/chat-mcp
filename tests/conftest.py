"""Shared test fixtures."""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from chat_mcp.server.db import init_db, get_db_context


@pytest_asyncio.fixture
async def client():
    """Async HTTP test client with in-memory DB initialized."""
    await init_db(":memory:")

    from chat_mcp.server.app import create_app
    test_app = create_app()

    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def room_and_participant(client):
    """Create a participant and a room, return both IDs."""
    resp = await client.post("/auth/register", json={
        "display_name": "alice",
        "type": "human",
    })
    assert resp.status_code == 200
    pid = resp.json()["participant_id"]

    resp = await client.post("/rooms", json={
        "name": f"test-room-{uuid.uuid4().hex[:8]}",
    }, headers={"X-Participant-ID": pid})
    assert resp.status_code == 200
    room_id = resp.json()["id"]

    return room_id, pid
