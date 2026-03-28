"""Room management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from chat_mcp.server.db import get_db_context
from chat_mcp.server.middleware import get_current_participant
from chat_mcp.server.models import CreateRoomRequest, SetTopicRequest, InviteRequest
from chat_mcp.server.services import room_service

router = APIRouter(tags=["rooms"])


@router.post("/rooms")
async def create_room(req: CreateRoomRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        room = await room_service.create_room(
            db, name=req.name, created_by=participant_id,
            topic=req.topic, participant_ids=req.participants,
        )
        return room.model_dump(mode="json")


@router.get("/rooms")
async def list_rooms(request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        rooms = await room_service.list_rooms(db, participant_id)
        return [r.model_dump(mode="json") for r in rooms]


@router.get("/rooms/{room_id}")
async def get_room(room_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")
        room = await room_service.get_room(db, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        return room.model_dump(mode="json")


@router.put("/rooms/{room_id}/topic")
async def set_topic(room_id: str, req: SetTopicRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")
        if not await room_service.set_topic(db, room_id, req.topic):
            raise HTTPException(status_code=404, detail="Room not found")
        return {"status": "ok"}


@router.post("/rooms/{room_id}/join")
async def join_room(room_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        await room_service.join_room(db, room_id, participant_id)
        return {"status": "ok"}


@router.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        await room_service.leave_room(db, room_id, participant_id)
        return {"status": "ok"}


@router.post("/rooms/{room_id}/invite")
async def invite(room_id: str, req: InviteRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.invite_to_room(db, room_id, req.participant_id, participant_id):
            raise HTTPException(status_code=403, detail="Cannot invite")
        return {"status": "ok"}


@router.post("/rooms/{room_id}/kick")
async def kick(room_id: str, req: InviteRequest, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.kick_from_room(db, room_id, req.participant_id, participant_id):
            raise HTTPException(status_code=403, detail="Cannot kick")
        return {"status": "ok"}


@router.get("/rooms/{room_id}/participants")
async def get_participants(room_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            raise HTTPException(status_code=403, detail="Not a room participant")
        room = await room_service.get_room(db, room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        from chat_mcp.server.auth import get_participant
        participants = []
        for pid in room.participants:
            p = await get_participant(db, pid)
            if p:
                participants.append(p.model_dump(mode="json"))
        return participants
