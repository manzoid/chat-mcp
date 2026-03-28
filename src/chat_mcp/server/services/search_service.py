"""Full-text search service using SQLite FTS5."""

from __future__ import annotations

from typing import Optional

import aiosqlite

from chat_mcp.shared.models import Message
from chat_mcp.server.services.message_service import get_message


async def search_messages(
    db: aiosqlite.Connection,
    query: str,
    room_id: Optional[str] = None,
    author_id: Optional[str] = None,
    before: Optional[str] = None,
    after: Optional[str] = None,
    has_attachment: Optional[bool] = None,
    limit: int = 50,
) -> list[Message]:
    """Search messages using FTS5."""
    sql = """
        SELECT m.id FROM messages m
        JOIN messages_fts fts ON m.rowid = fts.rowid
        WHERE messages_fts MATCH ? AND m.deleted = 0
    """
    params: list = [query]

    if room_id:
        sql += " AND m.room_id = ?"
        params.append(room_id)
    if author_id:
        sql += " AND m.author_id = ?"
        params.append(author_id)
    if before:
        sql += " AND m.created_at < ?"
        params.append(before)
    if after:
        sql += " AND m.created_at > ?"
        params.append(after)
    if has_attachment is True:
        sql += " AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)"
    if has_attachment is False:
        sql += " AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)"

    sql += " ORDER BY rank LIMIT ?"
    params.append(limit)

    cursor = await db.execute(sql, params)
    rows = await cursor.fetchall()

    messages = []
    for row in rows:
        msg = await get_message(db, row["id"])
        if msg:
            messages.append(msg)
    return messages
