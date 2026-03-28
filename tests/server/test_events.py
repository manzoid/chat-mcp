"""Tests for event service."""

from __future__ import annotations

import pytest
import pytest_asyncio

from chat_mcp.server.db import get_db_context, init_db
from chat_mcp.server.services.event_service import EventService
from chat_mcp.shared.models import EventType


@pytest.mark.asyncio
async def test_publish_and_retrieve_events():
    await init_db(":memory:")
    service = EventService()

    async with get_db_context() as db:
        # Create a room for events
        import uuid
        room_id = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO participants (id, display_name, type, created_at) VALUES (?, ?, ?, datetime('now'))",
            (pid, "test", "human"),
        )
        await db.execute(
            "INSERT INTO rooms (id, name, created_by, created_at) VALUES (?, ?, ?, datetime('now'))",
            (room_id, "test-room", pid),
        )
        await db.commit()

        # Publish events
        seq1 = await service.publish(db, room_id, EventType.MESSAGE_CREATED, {"text": "hello"})
        seq2 = await service.publish(db, room_id, EventType.MESSAGE_CREATED, {"text": "world"})

        assert seq2 > seq1

        # Retrieve events
        events = await service.get_events_since(db, room_id, 0)
        assert len(events) == 2
        assert events[0]["payload"]["text"] == "hello"
        assert events[1]["payload"]["text"] == "world"

        # Retrieve since seq1
        events = await service.get_events_since(db, room_id, seq1)
        assert len(events) == 1
        assert events[0]["payload"]["text"] == "world"
