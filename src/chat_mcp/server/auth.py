"""SSH challenge-response authentication and session management."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

import aiosqlite

from chat_mcp.shared.constants import SESSION_TOKEN_BYTES, SESSION_TOKEN_LIFETIME_HOURS
from chat_mcp.shared.models import Participant, ParticipantType, PresenceStatus
from chat_mcp.server.signing import verify_ssh_signature


# In-memory challenge store (challenge -> participant_id, expires_at)
_challenges: dict[str, tuple[str, datetime]] = {}


async def register_participant(
    db: aiosqlite.Connection,
    display_name: str,
    participant_type: str = "human",
    public_key: Optional[str] = None,
    paired_with: Optional[str] = None,
) -> Participant:
    participant_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    await db.execute(
        """INSERT INTO participants (id, display_name, type, paired_with, public_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (participant_id, display_name, participant_type, paired_with, public_key, now),
    )
    await db.commit()

    return Participant(
        id=participant_id,
        display_name=display_name,
        type=ParticipantType(participant_type),
        paired_with=paired_with,
        public_key=public_key,
        status=PresenceStatus(),
        created_at=now,
    )


async def get_participant(db: aiosqlite.Connection, participant_id: str) -> Participant | None:
    cursor = await db.execute("SELECT * FROM participants WHERE id = ?", (participant_id,))
    row = await cursor.fetchone()
    if not row:
        return None

    return Participant(
        id=row["id"],
        display_name=row["display_name"],
        type=ParticipantType(row["type"]),
        paired_with=row["paired_with"],
        public_key=row["public_key"],
        status=PresenceStatus(
            state=row["status_state"] or "offline",
            description=row["status_description"],
            updated_at=row["status_updated_at"],
        ),
        created_at=row["created_at"],
    )


async def get_participant_by_name(db: aiosqlite.Connection, name: str) -> Participant | None:
    cursor = await db.execute("SELECT * FROM participants WHERE display_name = ?", (name,))
    row = await cursor.fetchone()
    if not row:
        return None
    return await get_participant(db, row["id"])


def create_challenge(participant_id: str) -> str:
    """Generate a random challenge nonce for SSH auth."""
    challenge = secrets.token_hex(32)
    expires = datetime.now(timezone.utc) + timedelta(minutes=5)
    _challenges[challenge] = (participant_id, expires)
    return challenge


async def verify_challenge(
    db: aiosqlite.Connection,
    participant_id: str,
    signed_challenge: str,
) -> Optional[str]:
    """Verify a signed challenge and return a session token if valid.

    We look for any pending challenge for this participant_id, verify the signature,
    and if valid, issue a session token.
    """
    participant = await get_participant(db, participant_id)
    if not participant or not participant.public_key:
        return None

    now = datetime.now(timezone.utc)
    matched_challenge = None

    for challenge, (pid, expires) in list(_challenges.items()):
        if pid == participant_id and expires > now:
            # Try to verify the signed challenge against this nonce
            if verify_ssh_signature(
                challenge.encode("utf-8"), signed_challenge, participant.public_key
            ):
                matched_challenge = challenge
                break

    if not matched_challenge:
        return None

    del _challenges[matched_challenge]

    # Issue session token
    token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = (now + timedelta(hours=SESSION_TOKEN_LIFETIME_HOURS)).isoformat()

    await db.execute(
        "INSERT INTO sessions (id, participant_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), participant_id, token_hash, expires_at),
    )
    await db.commit()

    return token


async def validate_session_token(
    db: aiosqlite.Connection, token: str
) -> Optional[str]:
    """Validate a session token and return the participant_id if valid."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()

    cursor = await db.execute(
        "SELECT participant_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
        (token_hash, now),
    )
    row = await cursor.fetchone()
    return row["participant_id"] if row else None


async def revoke_sessions(db: aiosqlite.Connection, participant_id: str) -> None:
    await db.execute("DELETE FROM sessions WHERE participant_id = ?", (participant_id,))
    await db.commit()


async def rotate_key(
    db: aiosqlite.Connection, participant_id: str, new_public_key: str
) -> bool:
    cursor = await db.execute(
        "UPDATE participants SET public_key = ? WHERE id = ?",
        (new_public_key, participant_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def set_participant_status(
    db: aiosqlite.Connection,
    participant_id: str,
    state: str,
    description: Optional[str] = None,
) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    cursor = await db.execute(
        "UPDATE participants SET status_state = ?, status_description = ?, status_updated_at = ? WHERE id = ?",
        (state, description, now, participant_id),
    )
    await db.commit()
    return cursor.rowcount > 0
