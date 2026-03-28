"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from chat_mcp.server.db import get_db_context
from chat_mcp.server.auth import (
    register_participant,
    create_challenge,
    verify_challenge,
    revoke_sessions,
    rotate_key,
    get_participant,
)
from chat_mcp.server.models import (
    RegisterRequest,
    ChallengeRequest,
    ChallengeResponse,
    VerifyRequest,
    AuthTokenResponse,
    RevokeRequest,
    KeyRotateRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register")
async def register(req: RegisterRequest):
    async with get_db_context() as db:
        participant = await register_participant(
            db,
            display_name=req.display_name,
            participant_type=req.type,
            public_key=req.public_key,
            paired_with=req.paired_with,
        )
        return {"participant_id": participant.id}


@router.post("/challenge")
async def challenge(req: ChallengeRequest):
    async with get_db_context() as db:
        participant = await get_participant(db, req.participant_id)
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        if not participant.public_key:
            raise HTTPException(status_code=400, detail="No public key registered")

        nonce = create_challenge(req.participant_id)
        return ChallengeResponse(challenge=nonce)


@router.post("/verify")
async def verify(req: VerifyRequest):
    async with get_db_context() as db:
        token = await verify_challenge(db, req.participant_id, req.signed_challenge)
        if not token:
            raise HTTPException(status_code=401, detail="Verification failed")

        # Get the expiry from the session we just created
        import hashlib
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        cursor = await db.execute(
            "SELECT expires_at FROM sessions WHERE token_hash = ?", (token_hash,)
        )
        row = await cursor.fetchone()

        return AuthTokenResponse(
            session_token=token,
            expires_at=row["expires_at"],
            participant_id=req.participant_id,
        )


@router.post("/revoke")
async def revoke(req: RevokeRequest):
    async with get_db_context() as db:
        await revoke_sessions(db, req.participant_id)
        return {"status": "ok"}


@router.put("/keys")
async def rotate(req: KeyRotateRequest):
    # In production this would require auth; simplified for v1
    raise HTTPException(status_code=501, detail="Key rotation requires authenticated endpoint")
