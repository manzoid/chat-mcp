"""Participant and presence endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from chat_mcp.server.db import get_db_context
from chat_mcp.server.middleware import get_current_participant
from chat_mcp.server.models import SetStatusRequest, SetTypingRequest
from chat_mcp.server.auth import set_participant_status, get_participant
from chat_mcp.server.services.event_service import event_service
from chat_mcp.shared.models import EventType

router = APIRouter(tags=["participants"])


@router.post("/participants/me/status")
async def set_status(req: SetStatusRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await set_participant_status(db, participant_id, req.state, req.description):
            raise HTTPException(status_code=404, detail="Participant not found")

        # Broadcast status change to all rooms this participant is in
        cursor = await db.execute(
            "SELECT room_id FROM room_participants WHERE participant_id = ?",
            (participant_id,),
        )
        for row in await cursor.fetchall():
            await event_service.publish(
                db,
                row["room_id"],
                EventType.PARTICIPANT_STATUS,
                {"participant_id": participant_id, "state": req.state, "description": req.description},
            )
        return {"status": "ok"}


@router.post("/rooms/{room_id}/typing")
async def set_typing(room_id: str, req: SetTypingRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        # Typing is ephemeral — not stored, just broadcast
        await event_service.publish(
            db,
            room_id,
            EventType.PARTICIPANT_TYPING,
            {"participant_id": participant_id, "is_typing": req.is_typing},
        )
        return {"status": "ok"}
