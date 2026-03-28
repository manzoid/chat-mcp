"""Event bus for SSE broadcasting and event persistence."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import AsyncGenerator

import aiosqlite

from chat_mcp.shared.models import EventType


class EventService:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue]] = {}  # room_id -> queues

    def subscribe(self, room_id: str) -> asyncio.Queue:
        if room_id not in self._subscribers:
            self._subscribers[room_id] = []
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers[room_id].append(queue)
        return queue

    def unsubscribe(self, room_id: str, queue: asyncio.Queue) -> None:
        if room_id in self._subscribers:
            self._subscribers[room_id] = [q for q in self._subscribers[room_id] if q is not queue]

    async def publish(
        self, db: aiosqlite.Connection, room_id: str, event_type: EventType, payload: dict
    ) -> int:
        """Persist event and broadcast to subscribers. Returns sequence number."""
        now = datetime.now(timezone.utc).isoformat()
        payload_json = json.dumps(payload)

        cursor = await db.execute(
            "INSERT INTO events (room_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
            (room_id, event_type.value, payload_json, now),
        )
        seq = cursor.lastrowid
        await db.commit()

        event_data = {
            "seq": seq,
            "type": event_type.value,
            "room_id": room_id,
            "timestamp": now,
            "payload": payload,
        }

        if room_id in self._subscribers:
            for queue in self._subscribers[room_id]:
                await queue.put(event_data)

        return seq

    async def get_events_since(
        self, db: aiosqlite.Connection, room_id: str, since_seq: int
    ) -> list[dict]:
        cursor = await db.execute(
            "SELECT seq, type, room_id, payload, created_at FROM events WHERE room_id = ? AND seq > ? ORDER BY seq",
            (room_id, since_seq),
        )
        rows = await cursor.fetchall()
        return [
            {
                "seq": row["seq"],
                "type": row["type"],
                "room_id": row["room_id"],
                "timestamp": row["created_at"],
                "payload": json.loads(row["payload"]),
            }
            for row in rows
        ]

    async def stream_events(
        self, db: aiosqlite.Connection, room_id: str, since_seq: int = 0
    ) -> AsyncGenerator[dict, None]:
        """Stream events: first catch up from DB, then live from queue."""
        # Catch up
        past_events = await self.get_events_since(db, room_id, since_seq)
        for event in past_events:
            yield event
            since_seq = event["seq"]

        # Live stream
        queue = self.subscribe(room_id)
        try:
            while True:
                event = await queue.get()
                yield event
        finally:
            self.unsubscribe(room_id, queue)


# Global singleton
event_service = EventService()
