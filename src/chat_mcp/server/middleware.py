"""Authentication middleware and rate limiting."""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException

from chat_mcp.server.db import get_db
from chat_mcp.server.auth import validate_session_token


async def get_current_participant(request: Request) -> str:
    """Extract and validate the participant from the request.

    Supports both:
    - Bearer token auth (production): Authorization: Bearer <token>
    - Direct participant ID (development): X-Participant-ID: <id>
    """
    # Dev mode: direct participant ID header
    participant_id = request.headers.get("X-Participant-ID")
    if participant_id:
        return participant_id

    # Production: Bearer token
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:]
        db = await get_db()
        try:
            pid = await validate_session_token(db, token)
            if pid:
                return pid
        finally:
            await db.close()

    raise HTTPException(status_code=401, detail="Authentication required")


# Simple token bucket rate limiter
class RateLimiter:
    def __init__(self, max_tokens: int = 30, refill_rate: float = 1.0):
        self.max_tokens = max_tokens
        self.refill_rate = refill_rate  # tokens per second
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last_refill)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        if key not in self._buckets:
            self._buckets[key] = (self.max_tokens - 1, now)
            return True

        tokens, last_refill = self._buckets[key]
        elapsed = now - last_refill
        tokens = min(self.max_tokens, tokens + elapsed * self.refill_rate)

        if tokens < 1:
            return False

        self._buckets[key] = (tokens - 1, now)
        return True


rate_limiter = RateLimiter()
