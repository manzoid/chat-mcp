"""Reaction endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from chat_mcp.server.db import get_db_context
from chat_mcp.server.middleware import get_current_participant
from chat_mcp.server.models import AddReactionRequest
from chat_mcp.server.services import message_service

router = APIRouter(tags=["reactions"])


@router.post("/messages/{message_id}/reactions")
async def add_reaction(message_id: str, req: AddReactionRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await message_service.add_reaction(
            db, message_id, req.emoji, participant_id, req.signature,
        ):
            raise HTTPException(status_code=400, detail="Could not add reaction")
        return {"status": "ok"}


@router.delete("/messages/{message_id}/reactions/{emoji}")
async def remove_reaction(message_id: str, emoji: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await message_service.remove_reaction(db, message_id, emoji, participant_id):
            raise HTTPException(status_code=404, detail="Reaction not found")
        return {"status": "ok"}
