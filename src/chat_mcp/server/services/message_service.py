"""Message management service."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from chat_mcp.shared.models import (
    Attachment,
    AttachmentMetadata,
    EditRecord,
    EventType,
    Message,
    MessageContent,
    Reaction,
    ThreadSummary,
)
from chat_mcp.server.services.event_service import event_service


def _parse_message(row: aiosqlite.Row) -> Message:
    return Message(
        id=row["id"],
        room_id=row["room_id"],
        author_id=row["author_id"],
        content=MessageContent(format=row["content_format"], text=row["content_text"]),
        thread_id=row["thread_id"],
        mentions=[],
        reactions=[],
        attachments=[],
        signature=row["signature"],
        edited_at=row["edited_at"],
        edit_history=[],
        deleted=bool(row["deleted"]),
        created_at=row["created_at"],
    )


async def _enrich_message(db: aiosqlite.Connection, msg: Message) -> Message:
    """Load mentions, reactions, attachments, edit history for a message."""
    # Mentions
    cursor = await db.execute(
        "SELECT participant_id FROM mentions WHERE message_id = ?", (msg.id,)
    )
    msg.mentions = [r["participant_id"] for r in await cursor.fetchall()]

    # Reactions
    cursor = await db.execute(
        "SELECT * FROM reactions WHERE message_id = ? ORDER BY created_at", (msg.id,)
    )
    msg.reactions = [
        Reaction(
            emoji=r["emoji"],
            author_id=r["author_id"],
            signature=r["signature"],
            created_at=r["created_at"],
        )
        for r in await cursor.fetchall()
    ]

    # Attachments
    cursor = await db.execute(
        "SELECT * FROM attachments WHERE message_id = ?", (msg.id,)
    )
    msg.attachments = [
        Attachment(
            id=r["id"],
            filename=r["filename"],
            mime_type=r["mime_type"],
            size_bytes=r["size_bytes"],
            url=f"/attachments/{r['id']}",
            metadata=AttachmentMetadata(**json.loads(r["metadata"])) if r["metadata"] else None,
            uploaded_by=r["uploaded_by"],
            created_at=r["created_at"],
        )
        for r in await cursor.fetchall()
    ]

    # Edit history
    cursor = await db.execute(
        "SELECT * FROM edit_history WHERE message_id = ? ORDER BY edited_at", (msg.id,)
    )
    msg.edit_history = [
        EditRecord(
            content=MessageContent(format=r["content_format"], text=r["content_text"]),
            signature=r["signature"],
            edited_at=r["edited_at"],
        )
        for r in await cursor.fetchall()
    ]

    return msg


async def create_message(
    db: aiosqlite.Connection,
    room_id: str,
    author_id: str,
    content_text: str,
    content_format: str = "markdown",
    thread_id: Optional[str] = None,
    mentions: Optional[list[str]] = None,
    attachment_ids: Optional[list[str]] = None,
    signature: Optional[str] = None,
) -> Message:
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """INSERT INTO messages (id, room_id, author_id, content_format, content_text,
           thread_id, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (message_id, room_id, author_id, content_format, content_text, thread_id, signature, now),
    )

    for pid in mentions or []:
        await db.execute(
            "INSERT OR IGNORE INTO mentions (message_id, participant_id) VALUES (?, ?)",
            (message_id, pid),
        )

    # Link pre-uploaded attachments to this message
    for aid in attachment_ids or []:
        await db.execute(
            "UPDATE attachments SET message_id = ? WHERE id = ? AND room_id = ?",
            (message_id, aid, room_id),
        )

    await db.commit()

    msg = Message(
        id=message_id,
        room_id=room_id,
        author_id=author_id,
        content=MessageContent(format=content_format, text=content_text),
        thread_id=thread_id,
        mentions=mentions or [],
        reactions=[],
        attachments=[],
        signature=signature,
        deleted=False,
        created_at=now,
    )

    await event_service.publish(db, room_id, EventType.MESSAGE_CREATED, msg.model_dump(mode="json"))
    return msg


async def get_message(db: aiosqlite.Connection, message_id: str) -> Message | None:
    cursor = await db.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
    row = await cursor.fetchone()
    if not row:
        return None
    msg = _parse_message(row)
    return await _enrich_message(db, msg)


async def get_messages(
    db: aiosqlite.Connection,
    room_id: str,
    limit: int = 50,
    before: Optional[str] = None,
    after: Optional[str] = None,
    thread_id: Optional[str] = None,
) -> list[Message]:
    query = "SELECT * FROM messages WHERE room_id = ? AND deleted = 0"
    params: list = [room_id]

    if thread_id:
        query += " AND (thread_id = ? OR id = ?)"
        params.extend([thread_id, thread_id])

    if before:
        query += " AND created_at < ?"
        params.append(before)

    if after:
        query += " AND created_at > ?"
        params.append(after)

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()

    messages = []
    for row in reversed(rows):  # Return in chronological order
        msg = _parse_message(row)
        msg = await _enrich_message(db, msg)
        messages.append(msg)

    return messages


async def edit_message(
    db: aiosqlite.Connection,
    message_id: str,
    author_id: str,
    content_text: str,
    content_format: str = "markdown",
    signature: Optional[str] = None,
) -> Message | None:
    msg = await get_message(db, message_id)
    if not msg or msg.author_id != author_id:
        return None

    now = datetime.now(timezone.utc).isoformat()

    # Save old content to edit history
    await db.execute(
        """INSERT INTO edit_history (id, message_id, content_format, content_text, signature, edited_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), message_id, msg.content.format.value, msg.content.text, msg.signature, now),
    )

    # Update message
    await db.execute(
        "UPDATE messages SET content_format = ?, content_text = ?, signature = ?, edited_at = ? WHERE id = ?",
        (content_format, content_text, signature, now, message_id),
    )
    await db.commit()

    updated = await get_message(db, message_id)
    if updated:
        await event_service.publish(
            db,
            msg.room_id,
            EventType.MESSAGE_EDITED,
            {"message_id": message_id, "content": {"format": content_format, "text": content_text}, "edited_at": now},
        )
    return updated


async def delete_message(
    db: aiosqlite.Connection, message_id: str, author_id: str
) -> bool:
    cursor = await db.execute(
        "UPDATE messages SET deleted = 1 WHERE id = ? AND author_id = ?",
        (message_id, author_id),
    )
    await db.commit()
    if cursor.rowcount > 0:
        msg = await get_message(db, message_id)
        if msg:
            await event_service.publish(
                db, msg.room_id, EventType.MESSAGE_DELETED, {"message_id": message_id}
            )
        return True
    return False


async def add_reaction(
    db: aiosqlite.Connection,
    message_id: str,
    emoji: str,
    author_id: str,
    signature: Optional[str] = None,
) -> bool:
    msg = await get_message(db, message_id)
    if not msg:
        return False

    reaction_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    try:
        await db.execute(
            "INSERT INTO reactions (id, message_id, emoji, author_id, signature, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (reaction_id, message_id, emoji, author_id, signature, now),
        )
        await db.commit()
        await event_service.publish(
            db,
            msg.room_id,
            EventType.REACTION_ADDED,
            {"message_id": message_id, "reaction": {"emoji": emoji, "author_id": author_id, "created_at": now}},
        )
        return True
    except Exception:
        return False


async def remove_reaction(
    db: aiosqlite.Connection, message_id: str, emoji: str, author_id: str
) -> bool:
    msg = await get_message(db, message_id)
    if not msg:
        return False

    cursor = await db.execute(
        "DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND author_id = ?",
        (message_id, emoji, author_id),
    )
    await db.commit()
    if cursor.rowcount > 0:
        await event_service.publish(
            db,
            msg.room_id,
            EventType.REACTION_REMOVED,
            {"message_id": message_id, "emoji": emoji, "author_id": author_id},
        )
        return True
    return False


async def pin_message(
    db: aiosqlite.Connection, message_id: str, pinned_by: str
) -> bool:
    msg = await get_message(db, message_id)
    if not msg:
        return False

    now = datetime.now(timezone.utc).isoformat()
    try:
        await db.execute(
            "INSERT INTO pins (room_id, message_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)",
            (msg.room_id, message_id, pinned_by, now),
        )
        await db.commit()
        await event_service.publish(
            db,
            msg.room_id,
            EventType.MESSAGE_PINNED,
            {"message_id": message_id, "by": pinned_by},
        )
        return True
    except Exception:
        return False


async def unpin_message(db: aiosqlite.Connection, message_id: str) -> bool:
    msg = await get_message(db, message_id)
    if not msg:
        return False

    cursor = await db.execute(
        "DELETE FROM pins WHERE message_id = ?", (message_id,)
    )
    await db.commit()
    if cursor.rowcount > 0:
        await event_service.publish(
            db,
            msg.room_id,
            EventType.MESSAGE_UNPINNED,
            {"message_id": message_id},
        )
        return True
    return False


async def get_pins(db: aiosqlite.Connection, room_id: str) -> list[Message]:
    cursor = await db.execute(
        "SELECT message_id FROM pins WHERE room_id = ? ORDER BY pinned_at", (room_id,)
    )
    messages = []
    for row in await cursor.fetchall():
        msg = await get_message(db, row["message_id"])
        if msg:
            messages.append(msg)
    return messages


async def get_thread_summary(db: aiosqlite.Connection, message_id: str) -> ThreadSummary | None:
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM messages WHERE thread_id = ? AND deleted = 0",
        (message_id,),
    )
    row = await cursor.fetchone()
    if not row:
        return None

    pcursor = await db.execute(
        "SELECT DISTINCT author_id FROM messages WHERE thread_id = ?", (message_id,)
    )
    participants = [r["author_id"] for r in await pcursor.fetchall()]

    lcursor = await db.execute(
        "SELECT MAX(created_at) as last FROM messages WHERE thread_id = ?", (message_id,)
    )
    last_row = await lcursor.fetchone()

    return ThreadSummary(
        root_message_id=message_id,
        reply_count=row["cnt"],
        participants=participants,
        last_activity=last_row["last"] if last_row else None,
    )
