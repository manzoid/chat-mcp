"""Shared Pydantic models used by both server and client."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class ParticipantType(str, Enum):
    HUMAN = "human"
    AGENT = "agent"


class PresenceState(str, Enum):
    ONLINE = "online"
    AWAY = "away"
    BUSY = "busy"
    OFFLINE = "offline"


class ContentFormat(str, Enum):
    MARKDOWN = "markdown"
    PLAIN = "plain"


# --- Participant ---


class PresenceStatus(BaseModel):
    state: PresenceState = PresenceState.OFFLINE
    description: Optional[str] = None
    updated_at: Optional[datetime] = None


class Participant(BaseModel):
    id: str
    display_name: str
    type: ParticipantType
    paired_with: Optional[str] = None
    public_key: Optional[str] = None
    status: PresenceStatus = Field(default_factory=PresenceStatus)
    created_at: datetime


# --- Room ---


class Room(BaseModel):
    id: str
    name: str
    topic: Optional[str] = None
    participants: list[str] = Field(default_factory=list)
    pinned: list[str] = Field(default_factory=list)
    created_at: datetime
    created_by: str


# --- Message ---


class MessageContent(BaseModel):
    format: ContentFormat = ContentFormat.MARKDOWN
    text: str


class Reaction(BaseModel):
    emoji: str
    author_id: str
    signature: Optional[str] = None
    created_at: datetime


class EditRecord(BaseModel):
    content: MessageContent
    signature: Optional[str] = None
    edited_at: datetime


class AttachmentMetadata(BaseModel):
    width: Optional[int] = None
    height: Optional[int] = None
    language: Optional[str] = None
    line_count: Optional[int] = None
    checksum: Optional[str] = None
    description: Optional[str] = None


class Attachment(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    url: str
    metadata: Optional[AttachmentMetadata] = None
    uploaded_by: str
    created_at: datetime


class Message(BaseModel):
    id: str
    room_id: str
    author_id: str
    content: MessageContent
    thread_id: Optional[str] = None
    mentions: list[str] = Field(default_factory=list)
    reactions: list[Reaction] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)
    signature: Optional[str] = None
    edited_at: Optional[datetime] = None
    edit_history: list[EditRecord] = Field(default_factory=list)
    deleted: bool = False
    created_at: datetime


class ThreadSummary(BaseModel):
    root_message_id: str
    reply_count: int
    participants: list[str]
    last_activity: Optional[datetime] = None


# --- Events ---


class EventType(str, Enum):
    MESSAGE_CREATED = "message.created"
    MESSAGE_EDITED = "message.edited"
    MESSAGE_DELETED = "message.deleted"
    REACTION_ADDED = "reaction.added"
    REACTION_REMOVED = "reaction.removed"
    PARTICIPANT_JOINED = "participant.joined"
    PARTICIPANT_LEFT = "participant.left"
    PARTICIPANT_STATUS = "participant.status"
    PARTICIPANT_TYPING = "participant.typing"
    ROOM_TOPIC = "room.topic"
    MESSAGE_PINNED = "message.pinned"
    MESSAGE_UNPINNED = "message.unpinned"
    ATTACHMENT_UPLOADED = "attachment.uploaded"


class Event(BaseModel):
    seq: int
    type: EventType
    room_id: str
    timestamp: datetime
    payload: dict
