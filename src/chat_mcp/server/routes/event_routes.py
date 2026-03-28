"""Server-Sent Events endpoint for real-time streaming."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request, Query
from sse_starlette.sse import EventSourceResponse

from chat_mcp.server.db import get_db_context, get_db
from chat_mcp.server.middleware import get_current_participant
from chat_mcp.server.services.event_service import event_service
from chat_mcp.server.services import room_service
from chat_mcp.shared.constants import HEARTBEAT_INTERVAL_SECONDS

router = APIRouter(tags=["events"])


@router.get("/rooms/{room_id}/events")
async def stream_events(
    room_id: str,
    request: Request,
    since_seq: int = Query(default=0),
):
    participant_id = await get_current_participant(request)

    async def event_generator():
        db = await get_db()
        try:
            if not await room_service.is_participant(db, room_id, participant_id):
                yield {"event": "error", "data": json.dumps({"detail": "Not a room participant"})}
                return

            # Send catch-up events
            past_events = await event_service.get_events_since(db, room_id, since_seq)
            for event in past_events:
                yield {
                    "id": str(event["seq"]),
                    "event": event["type"],
                    "data": json.dumps(event),
                }

            # Subscribe for live events
            queue = event_service.subscribe(room_id)
            try:
                while True:
                    try:
                        event = await asyncio.wait_for(
                            queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS
                        )
                        yield {
                            "id": str(event["seq"]),
                            "event": event["type"],
                            "data": json.dumps(event),
                        }
                    except asyncio.TimeoutError:
                        # Heartbeat to keep connection alive
                        yield {"comment": "heartbeat"}
            finally:
                event_service.unsubscribe(room_id, queue)
        finally:
            await db.close()

    return EventSourceResponse(event_generator())


@router.post("/rooms/{room_id}/messages/pin/{message_id}")
async def pin_message(room_id: str, message_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Not a room participant")

        from chat_mcp.server.services.message_service import pin_message as pin_svc
        if not await pin_svc(db, message_id, participant_id):
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Could not pin message")
        return {"status": "ok"}


@router.delete("/rooms/{room_id}/messages/pin/{message_id}")
async def unpin_message(room_id: str, message_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Not a room participant")

        from chat_mcp.server.services.message_service import unpin_message as unpin_svc
        if not await unpin_svc(db, message_id):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Pin not found")
        return {"status": "ok"}


@router.get("/rooms/{room_id}/pins")
async def get_pins(room_id: str, request: Request):
    participant_id = await get_current_participant(request)
    async with get_db_context() as db:
        if not await room_service.is_participant(db, room_id, participant_id):
            from fastapi import HTTPException
            raise HTTPException(status_code=403, detail="Not a room participant")

        from chat_mcp.server.services.message_service import get_pins as get_pins_svc
        pins = await get_pins_svc(db, room_id)
        return [p.model_dump(mode="json") for p in pins]
