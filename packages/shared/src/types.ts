// === Identity ===

export interface Participant {
  id: string;
  display_name: string;
  type: "human" | "agent";
  paired_with: string | null;
  public_key: string;
  status: PresenceStatus;
  created_at: string; // ISO 8601
}

export interface PresenceStatus {
  state: "online" | "away" | "busy" | "offline";
  description: string | null;
  updated_at: string;
}

// === Rooms ===

export interface Room {
  id: string;
  name: string;
  topic: string | null;
  participants: string[]; // participant IDs
  pinned: string[]; // message IDs
  created_at: string;
  created_by: string;
}

// === Messages ===

export interface Message {
  id: string;
  room_id: string;
  author_id: string;
  content: MessageContent;
  thread_id: string | null;
  mentions: string[];
  reactions: Reaction[];
  attachments: Attachment[];
  signature: string;
  edited_at: string | null;
  edit_history: EditRecord[];
  deleted: boolean;
  created_at: string;
}

export interface MessageContent {
  format: "markdown" | "plain";
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

// === Attachments ===

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

export interface AttachmentMetadata {
  width?: number;
  height?: number;
  language?: string;
  line_count?: number;
  checksum?: string;
  description?: string;
}

// === Events ===

export interface ChatEvent {
  seq: number;
  type: EventType;
  room_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

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

// === Signing Payloads ===

export interface SignedMessagePayload {
  room_id: string;
  content: MessageContent;
  thread_id: string | null;
  mentions: string[];
  attachments: string[]; // attachment IDs
  timestamp: string;
  nonce: string;
}

export interface SignedReactionPayload {
  message_id: string;
  emoji: string;
  author_id: string;
}

export interface SignedEditPayload {
  message_id: string;
  content: MessageContent;
  timestamp: string;
}

export interface SignedDeletePayload {
  message_id: string;
  timestamp: string;
}

// === API Types ===

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  has_more: boolean;
}
