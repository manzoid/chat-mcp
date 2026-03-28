"""Attachment endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse

from chat_mcp.server.config import config
from chat_mcp.server.db import get_db_context
from chat_mcp.server.middleware import get_current_participant
from chat_mcp.server.services import attachment_service, room_service

router = APIRouter(tags=["attachments"])


@router.post("/rooms/{room_id}/attachments")
async def upload_attachment(
    room_id: str, request: Request, file: UploadFile = File(...)
):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")

        content = await file.read()
        if len(content) > config.max_attachment_bytes:
            raise HTTPException(status_code=413, detail="File too large")

        attachment = await attachment_service.upload_attachment(
            db,
            room_id=room_id,
            uploaded_by=participant_id,
            filename=file.filename or "unnamed",
            content=content,
            mime_type=file.content_type,
        )
        return attachment.model_dump(mode="json")


@router.get("/attachments/{attachment_id}")
async def download_attachment(attachment_id: str, request: Request):
    await get_current_participant(request)
    async with get_db_context() as db:
        meta = await attachment_service.get_attachment_metadata(db, attachment_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Attachment not found")

        path = attachment_service.get_attachment_path(attachment_id, meta.filename)
        if not path:
            raise HTTPException(status_code=404, detail="File not found on disk")

        return FileResponse(path, filename=meta.filename, media_type=meta.mime_type)


@router.get("/attachments/{attachment_id}/metadata")
async def get_attachment_metadata(attachment_id: str, request: Request):
    await get_current_participant(request)
    async with get_db_context() as db:
        meta = await attachment_service.get_attachment_metadata(db, attachment_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Attachment not found")
        return meta.model_dump(mode="json")
