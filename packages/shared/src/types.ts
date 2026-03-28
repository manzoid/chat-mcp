// Protocol data model types from PROTOCOL.md

export type ParticipantType = "human" | "agent";
export type PresenceState = "online" | "away" | "busy" | "offline";
export type ContentFormat = "markdown" | "plain";

export interface KeyRecord {
  public_key: string;
  valid_from: string; // ISO 8601 timestamp
  valid_until: string | null;
  fingerprint: string;
}

export interface PresenceStatus {
  state: PresenceState;
  description: string | null;
  updated_at: string;
}

export interface Participant {
  id: string;
  display_name: string;
  type: ParticipantType;
  paired_with: string | null;
  public_key: string;
  key_history: KeyRecord[];
  status: PresenceStatus;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
  topic: string | null;
  participants: string[];
  pinned: string[];
  created_at: string;
  created_by: string;
}

export interface MessageContent {
  format: ContentFormat;
  text: string;
}

export interface Reaction {
  emoji: string;
  author_id: string;
  signature: string;
  created_at: string;
}

export interface EditRecord {
  content: MessageContent;
  signature: string;
  edited_at: string;
}

export interface AttachmentMetadata {
  width?: number | null;
  height?: number | null;
  language?: string | null;
  line_count?: number | null;
  checksum?: string | null;
  description?: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  metadata: AttachmentMetadata | null;
  uploaded_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  author_id: string;
  content: MessageContent;
  thread_id: string | null;
  mentions: string[];
  reactions: Reaction[];
  attachments: Attachment[];
  nonce: string;
  signature: string;
  edited_at: string | null;
  edit_history: EditRecord[];
  deleted: boolean;
  deleted_signature: string | null;
  created_at: string;
}

// Signed payload types — these are what get canonicalized and signed

export interface SignedMessagePayload {
  room_id: string;
  content: MessageContent;
  thread_id: string | null;
  mentions: string[];
  attachments: string[]; // attachment IDs
  nonce: string;
  timestamp: string; // ISO 8601
}

export interface SignedEditPayload {
  message_id: string;
  content: MessageContent;
  nonce: string;
  timestamp: string;
}

export interface SignedDeletePayload {
  message_id: string;
  action: "delete";
  author_id: string;
  nonce: string;
  timestamp: string;
}

export interface SignedReactionPayload {
  message_id: string;
  emoji: string;
  author_id: string;
}

// Events

export type EventType =
  | "message.created"
  | "message.edited"
  | "message.deleted"
  | "reaction.added"
  | "reaction.removed"
  | "participant.joined"
  | "participant.left"
  | "participant.status"
  | "participant.typing"
  | "room.topic"
  | "message.pinned"
  | "message.unpinned"
  | "attachment.uploaded";

export interface ChatEvent {
  seq: number;
  type: EventType;
  room_id: string;
  timestamp: string;
  payload: unknown;
}

// API response types

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  has_more: boolean;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface AuthChallengeResponse {
  challenge: string;
}

export interface AuthVerifyResponse {
  session_token: string;
  expires_at: string;
}

export interface HealthResponse {
  status: "ok";
  protocol_version: number;
  min_protocol_version: number;
  uptime_seconds: number;
}
