"""Message endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Query

from chat_mcp.server.db import get_db_context
from chat_mcp.server.middleware import get_current_participant, rate_limiter
from chat_mcp.server.models import SendMessageRequest, EditMessageRequest
from chat_mcp.server.services import message_service, room_service

router = APIRouter(tags=["messages"])


@router.post("/rooms/{room_id}/messages")
async def send_message(room_id: str, req: SendMessageRequest, request: Request):
    participant_id = await get_current_participant(request)

    if not rate_limiter.allow(participant_id):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")

        msg = await message_service.create_message(
            db,
            room_id=room_id,
            author_id=participant_id,
            content_text=req.content_text,
            content_format=req.content_format.value,
            thread_id=req.thread_id,
            mentions=req.mentions,
            attachment_ids=req.attachment_ids,
            signature=req.signature,
        )
        return msg.model_dump(mode="json")


@router.get("/rooms/{room_id}/messages")
async def get_messages(
    room_id: str,
    request: Request,
    limit: int = Query(default=50, le=200),
    before: Optional[str] = None,
    after: Optional[str] = None,
    thread_id: Optional[str] = None,
):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")

        messages = await message_service.get_messages(
            db, room_id, limit=limit, before=before, after=after, thread_id=thread_id,
        )
        return [m.model_dump(mode="json") for m in messages]


@router.get("/rooms/{room_id}/messages/search")
async def search_messages(
    room_id: str,
    request: Request,
    q: str = Query(...),
    author: Optional[str] = None,
    before: Optional[str] = None,
    after: Optional[str] = None,
):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")

        from chat_mcp.server.services.search_service import search_messages as search_svc
        messages = await search_svc(
            db, query=q, room_id=room_id, author_id=author, before=before, after=after,
        )
        return [m.model_dump(mode="json") for m in messages]


@router.get("/messages/{message_id}")
async def get_message(message_id: str, request: Request):
    await get_current_participant(request)
    async with get_db_context() as db:
        msg = await message_service.get_message(db, message_id)
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        return msg.model_dump(mode="json")


@router.patch("/messages/{message_id}")
async def edit_message(message_id: str, req: EditMessageRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        msg = await message_service.edit_message(
            db, message_id, participant_id, req.content_text, req.content_format.value, req.signature,
        )
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found or not your message")
        return msg.model_dump(mode="json")


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await message_service.delete_message(db, message_id, participant_id):
            raise HTTPException(status_code=404, detail="Message not found or not your message")
        return {"status": "ok"}


@router.get("/messages/{message_id}/thread")
async def get_thread_summary(message_id: str, request: Request):
    await get_current_participant(request)
    async with get_db_context() as db:
        summary = await message_service.get_thread_summary(db, message_id)
        if not summary:
            raise HTTPException(status_code=404, detail="Message not found")
        return summary.model_dump(mode="json")
