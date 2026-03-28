"""API request/response models specific to the server."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from chat_mcp.shared.models import ContentFormat


# --- Auth ---


class RegisterRequest(BaseModel):
    display_name: str
    type: str = "human"
    public_key: Optional[str] = None
    paired_with: Optional[str] = None
    github_username: Optional[str] = None


class ChallengeRequest(BaseModel):
    participant_id: str


class ChallengeResponse(BaseModel):
    challenge: str


class VerifyRequest(BaseModel):
    participant_id: str
    signed_challenge: str


class AuthTokenResponse(BaseModel):
    session_token: str
    expires_at: str
    participant_id: str


class RevokeRequest(BaseModel):
    participant_id: str


class KeyRotateRequest(BaseModel):
    public_key: str


# --- Rooms ---


class CreateRoomRequest(BaseModel):
    name: str
    topic: Optional[str] = None
    participants: list[str] = []


class SetTopicRequest(BaseModel):
    topic: str


class InviteRequest(BaseModel):
    participant_id: str


# --- Messages ---


class SendMessageRequest(BaseModel):
    content_format: ContentFormat = ContentFormat.MARKDOWN
    content_text: str
    thread_id: Optional[str] = None
    mentions: list[str] = []
    attachment_ids: list[str] = []
    signature: Optional[str] = None
    timestamp: Optional[str] = None


class EditMessageRequest(BaseModel):
    content_format: ContentFormat = ContentFormat.MARKDOWN
    content_text: str
    signature: Optional[str] = None


# --- Reactions ---


class AddReactionRequest(BaseModel):
    emoji: str
    signature: Optional[str] = None


# --- Presence ---


class SetStatusRequest(BaseModel):
    state: str
    description: Optional[str] = None


class SetTypingRequest(BaseModel):
    is_typing: bool
