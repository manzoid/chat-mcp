"""Attachment storage and management service."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

from chat_mcp.shared.models import Attachment, AttachmentMetadata, EventType
from chat_mcp.server.config import config
from chat_mcp.server.services.event_service import event_service


async def upload_attachment(
    db: aiosqlite.Connection,
    room_id: str,
    uploaded_by: str,
    filename: str,
    content: bytes,
    mime_type: Optional[str] = None,
) -> Attachment:
    attachment_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    if not mime_type:
        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    checksum = hashlib.sha256(content).hexdigest()
    size_bytes = len(content)

    # Store file on disk
    attachment_dir = config.attachments_dir / attachment_id
    attachment_dir.mkdir(parents=True, exist_ok=True)
    (attachment_dir / filename).write_bytes(content)

    metadata = {"checksum": checksum}

    await db.execute(
        """INSERT INTO attachments (id, room_id, filename, mime_type, size_bytes, checksum, uploaded_by, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (attachment_id, room_id, filename, mime_type, size_bytes, checksum, uploaded_by, json.dumps(metadata), now),
    )
    await db.commit()

    attachment = Attachment(
        id=attachment_id,
        filename=filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        url=f"/attachments/{attachment_id}",
        metadata=AttachmentMetadata(checksum=checksum),
        uploaded_by=uploaded_by,
        created_at=now,
    )

    await event_service.publish(
        db, room_id, EventType.ATTACHMENT_UPLOADED, attachment.model_dump(mode="json")
    )
    return attachment


async def get_attachment_metadata(
    db: aiosqlite.Connection, attachment_id: str
) -> Attachment | None:
    cursor = await db.execute("SELECT * FROM attachments WHERE id = ?", (attachment_id,))
    row = await cursor.fetchone()
    if not row:
        return None

    meta = AttachmentMetadata(**json.loads(row["metadata"])) if row["metadata"] else None
    return Attachment(
        id=row["id"],
        filename=row["filename"],
        mime_type=row["mime_type"],
        size_bytes=row["size_bytes"],
        url=f"/attachments/{row['id']}",
        metadata=meta,
        uploaded_by=row["uploaded_by"],
        created_at=row["created_at"],
    )


def get_attachment_path(attachment_id: str, filename: str) -> Path | None:
    path = config.attachments_dir / attachment_id / filename
    if path.exists():
        return path
    return None
