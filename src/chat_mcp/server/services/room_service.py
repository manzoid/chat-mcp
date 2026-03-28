"""Room management service."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import aiosqlite

from chat_mcp.shared.models import EventType, Room
from chat_mcp.server.services.event_service import event_service


async def create_room(
    db: aiosqlite.Connection,
    name: str,
    created_by: str,
    topic: str | None = None,
    participant_ids: list[str] | None = None,
) -> Room:
    room_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        "INSERT INTO rooms (id, name, topic, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
        (room_id, name, topic, created_by, now),
    )
    # Creator always joins
    await db.execute(
        "INSERT INTO room_participants (room_id, participant_id, joined_at) VALUES (?, ?, ?)",
        (room_id, created_by, now),
    )
    participants = [created_by]
    # Invite additional participants
    for pid in participant_ids or []:
        if pid != created_by:
            await db.execute(
                "INSERT OR IGNORE INTO room_participants (room_id, participant_id, joined_at) VALUES (?, ?, ?)",
                (room_id, pid, now),
            )
            participants.append(pid)

    await db.commit()
    return Room(
        id=room_id,
        name=name,
        topic=topic,
        participants=participants,
        pinned=[],
        created_at=now,
        created_by=created_by,
    )


async def get_room(db: aiosqlite.Connection, room_id: str) -> Room | None:
    cursor = await db.execute("SELECT * FROM rooms WHERE id = ?", (room_id,))
    row = await cursor.fetchone()
    if not row:
        return None

    pcursor = await db.execute(
        "SELECT participant_id FROM room_participants WHERE room_id = ?", (room_id,)
    )
    participants = [r["participant_id"] for r in await pcursor.fetchall()]

    pincursor = await db.execute(
        "SELECT message_id FROM pins WHERE room_id = ?", (room_id,)
    )
    pinned = [r["message_id"] for r in await pincursor.fetchall()]

    return Room(
        id=row["id"],
        name=row["name"],
        topic=row["topic"],
        participants=participants,
        pinned=pinned,
        created_at=row["created_at"],
        created_by=row["created_by"],
    )


async def list_rooms(db: aiosqlite.Connection, participant_id: str) -> list[Room]:
    cursor = await db.execute(
        """SELECT r.* FROM rooms r
           JOIN room_participants rp ON r.id = rp.room_id
           WHERE rp.participant_id = ?""",
        (participant_id,),
    )
    rooms = []
    for row in await cursor.fetchall():
        room = await get_room(db, row["id"])
        if room:
            rooms.append(room)
    return rooms


async def join_room(db: aiosqlite.Connection, room_id: str, participant_id: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    try:
        await db.execute(
            "INSERT INTO room_participants (room_id, participant_id, joined_at) VALUES (?, ?, ?)",
            (room_id, participant_id, now),
        )
        await db.commit()
        await event_service.publish(
            db, room_id, EventType.PARTICIPANT_JOINED, {"participant_id": participant_id}
        )
        return True
    except aiosqlite.IntegrityError:
        return False


async def leave_room(db: aiosqlite.Connection, room_id: str, participant_id: str) -> bool:
    cursor = await db.execute(
        "DELETE FROM room_participants WHERE room_id = ? AND participant_id = ?",
        (room_id, participant_id),
    )
    await db.commit()
    if cursor.rowcount > 0:
        await event_service.publish(
            db, room_id, EventType.PARTICIPANT_LEFT, {"participant_id": participant_id}
        )
        return True
    return False


async def set_topic(db: aiosqlite.Connection, room_id: str, topic: str) -> bool:
    cursor = await db.execute(
        "UPDATE rooms SET topic = ? WHERE id = ?", (topic, room_id)
    )
    await db.commit()
    if cursor.rowcount > 0:
        await event_service.publish(
            db, room_id, EventType.ROOM_TOPIC, {"topic": topic}
        )
        return True
    return False


async def is_participant(db: aiosqlite.Connection, room_id: str, participant_id: str) -> bool:
    cursor = await db.execute(
        "SELECT 1 FROM room_participants WHERE room_id = ? AND participant_id = ?",
        (room_id, participant_id),
    )
    return await cursor.fetchone() is not None


async def invite_to_room(
    db: aiosqlite.Connection, room_id: str, participant_id: str, invited_by: str
) -> bool:
    if not await is_participant(db, room_id, invited_by):
        return False
    return await join_room(db, room_id, participant_id)


async def kick_from_room(
    db: aiosqlite.Connection, room_id: str, participant_id: str, kicked_by: str
) -> bool:
    room = await get_room(db, room_id)
    if not room:
        return False
    if kicked_by != room.created_by and not await is_participant(db, room_id, kicked_by):
        return False
    return await leave_room(db, room_id, participant_id)
