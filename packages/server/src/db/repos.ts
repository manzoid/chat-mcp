import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

// === Participants ===

export interface DbParticipant {
  id: string;
  display_name: string;
  type: "human" | "agent";
  paired_with: string | null;
  public_key_pem: string;
  github_username: string | null;
  created_at: string;
}

export interface DbPresence {
  participant_id: string;
  state: string;
  description: string | null;
  updated_at: string;
}

export class ParticipantRepo {
  constructor(private db: Database) {}

  create(params: {
    display_name: string;
    type: "human" | "agent";
    public_key_pem: string;
    paired_with?: string;
    github_username?: string;
  }): DbParticipant {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO participants (id, display_name, type, paired_with, public_key_pem, github_username)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, params.display_name, params.type, params.paired_with ?? null, params.public_key_pem, params.github_username ?? null]
    );
    this.db.run(
      `INSERT INTO presence (participant_id, state) VALUES (?, 'offline')`,
      [id]
    );
    return this.getById(id)!;
  }

  getById(id: string): DbParticipant | null {
    return this.db.query("SELECT * FROM participants WHERE id = ?").get(id) as DbParticipant | null;
  }

  getByDisplayName(name: string): DbParticipant | null {
    return this.db.query("SELECT * FROM participants WHERE display_name = ?").get(name) as DbParticipant | null;
  }

  getPresence(participantId: string): DbPresence | null {
    return this.db.query("SELECT * FROM presence WHERE participant_id = ?").get(participantId) as DbPresence | null;
  }

  updatePresence(participantId: string, state: string, description: string | null): void {
    this.db.run(
      `UPDATE presence SET state = ?, description = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE participant_id = ?`,
      [state, description, participantId]
    );
  }
}

// === Rooms ===

export interface DbRoom {
  id: string;
  name: string;
  topic: string | null;
  created_by: string;
  created_at: string;
}

export class RoomRepo {
  constructor(private db: Database) {}

  create(name: string, createdBy: string): DbRoom {
    const id = randomUUID();
    this.db.run(
      "INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)",
      [id, name, createdBy]
    );
    // Creator auto-joins
    this.db.run(
      "INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)",
      [id, createdBy, createdBy]
    );
    return this.getById(id)!;
  }

  getById(id: string): DbRoom | null {
    return this.db.query("SELECT * FROM rooms WHERE id = ?").get(id) as DbRoom | null;
  }

  listForParticipant(participantId: string): DbRoom[] {
    return this.db.query(
      `SELECT r.* FROM rooms r
       JOIN room_members rm ON r.id = rm.room_id
       WHERE rm.participant_id = ?
       ORDER BY r.created_at`
    ).all(participantId) as DbRoom[];
  }

  isMember(roomId: string, participantId: string): boolean {
    const row = this.db.query(
      "SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?"
    ).get(roomId, participantId);
    return row !== null;
  }

  addMember(roomId: string, participantId: string, invitedBy: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)",
      [roomId, participantId, invitedBy]
    );
  }

  removeMember(roomId: string, participantId: string): void {
    this.db.run(
      "DELETE FROM room_members WHERE room_id = ? AND participant_id = ?",
      [roomId, participantId]
    );
  }

  getMembers(roomId: string): DbParticipant[] {
    return this.db.query(
      `SELECT p.* FROM participants p
       JOIN room_members rm ON p.id = rm.participant_id
       WHERE rm.room_id = ?`
    ).all(roomId) as DbParticipant[];
  }

  setTopic(roomId: string, topic: string | null): void {
    this.db.run("UPDATE rooms SET topic = ? WHERE id = ?", [topic, roomId]);
  }
}

// === Messages ===

export interface DbMessage {
  id: string;
  room_id: string;
  author_id: string;
  content_format: string;
  content_text: string;
  thread_id: string | null;
  signature: string;
  nonce: string;
  deleted: number;
  edited_at: string | null;
  created_at: string;
}

export class MessageRepo {
  constructor(private db: Database) {}

  create(params: {
    room_id: string;
    author_id: string;
    content_format: string;
    content_text: string;
    thread_id?: string;
    signature: string;
    nonce: string;
    mentions?: string[];
  }): DbMessage {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, thread_id, signature, nonce)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, params.room_id, params.author_id, params.content_format, params.content_text, params.thread_id ?? null, params.signature, params.nonce]
    );
    if (params.mentions?.length) {
      const stmt = this.db.prepare("INSERT INTO mentions (message_id, participant_id) VALUES (?, ?)");
      for (const pid of params.mentions) {
        stmt.run(id, pid);
      }
    }
    return this.getById(id)!;
  }

  getById(id: string): DbMessage | null {
    return this.db.query("SELECT * FROM messages WHERE id = ?").get(id) as DbMessage | null;
  }

  listForRoom(roomId: string, limit: number = 50, before?: string): DbMessage[] {
    if (before) {
      return this.db.query(
        `SELECT * FROM messages WHERE room_id = ? AND created_at < ? AND deleted = 0
         ORDER BY created_at DESC LIMIT ?`
      ).all(roomId, before, limit) as DbMessage[];
    }
    return this.db.query(
      `SELECT * FROM messages WHERE room_id = ? AND deleted = 0
       ORDER BY created_at DESC LIMIT ?`
    ).all(roomId, limit) as DbMessage[];
  }

  getThread(threadId: string): DbMessage[] {
    return this.db.query(
      `SELECT * FROM messages WHERE thread_id = ? AND deleted = 0
       ORDER BY created_at ASC`
    ).all(threadId) as DbMessage[];
  }

  edit(messageId: string, contentFormat: string, contentText: string, signature: string): void {
    // Save old version
    const old = this.getById(messageId);
    if (!old) return;
    this.db.run(
      `INSERT INTO edit_history (message_id, content_format, content_text, signature)
       VALUES (?, ?, ?, ?)`,
      [messageId, old.content_format, old.content_text, old.signature]
    );
    this.db.run(
      `UPDATE messages SET content_format = ?, content_text = ?, signature = ?,
       edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      [contentFormat, contentText, signature, messageId]
    );
  }

  softDelete(messageId: string): void {
    this.db.run("UPDATE messages SET deleted = 1 WHERE id = ?", [messageId]);
  }

  search(roomId: string, query: string, limit: number = 20): DbMessage[] {
    return this.db.query(
      `SELECT m.* FROM messages m
       JOIN messages_fts fts ON m.rowid = fts.rowid
       WHERE fts.messages_fts MATCH ? AND m.room_id = ? AND m.deleted = 0
       ORDER BY m.created_at DESC LIMIT ?`
    ).all(query, roomId, limit) as DbMessage[];
  }

  getMentions(messageId: string): string[] {
    const rows = this.db.query(
      "SELECT participant_id FROM mentions WHERE message_id = ?"
    ).all(messageId) as { participant_id: string }[];
    return rows.map((r) => r.participant_id);
  }

  getEditHistory(messageId: string): { content_format: string; content_text: string; signature: string; edited_at: string }[] {
    return this.db.query(
      "SELECT content_format, content_text, signature, edited_at FROM edit_history WHERE message_id = ? ORDER BY edited_at ASC"
    ).all(messageId) as any[];
  }
}

// === Reactions ===

export interface DbReaction {
  message_id: string;
  author_id: string;
  emoji: string;
  signature: string;
  created_at: string;
}

export class ReactionRepo {
  constructor(private db: Database) {}

  add(messageId: string, authorId: string, emoji: string, signature: string): void {
    this.db.run(
      "INSERT OR REPLACE INTO reactions (message_id, author_id, emoji, signature) VALUES (?, ?, ?, ?)",
      [messageId, authorId, emoji, signature]
    );
  }

  remove(messageId: string, authorId: string, emoji: string): void {
    this.db.run(
      "DELETE FROM reactions WHERE message_id = ? AND author_id = ? AND emoji = ?",
      [messageId, authorId, emoji]
    );
  }

  getForMessage(messageId: string): DbReaction[] {
    return this.db.query(
      "SELECT * FROM reactions WHERE message_id = ?"
    ).all(messageId) as DbReaction[];
  }
}

// === Attachments ===

export interface DbAttachment {
  id: string;
  message_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  checksum: string | null;
  uploaded_by: string;
  created_at: string;
}

export class AttachmentRepo {
  constructor(private db: Database) {}

  create(params: {
    message_id?: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    checksum?: string;
    uploaded_by: string;
  }): DbAttachment {
    const id = randomUUID();
    this.db.run(
      `INSERT INTO attachments (id, message_id, filename, mime_type, size_bytes, storage_path, checksum, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, params.message_id ?? null, params.filename, params.mime_type, params.size_bytes, params.storage_path, params.checksum ?? null, params.uploaded_by]
    );
    return this.getById(id)!;
  }

  getById(id: string): DbAttachment | null {
    return this.db.query("SELECT * FROM attachments WHERE id = ?").get(id) as DbAttachment | null;
  }

  getForMessage(messageId: string): DbAttachment[] {
    return this.db.query("SELECT * FROM attachments WHERE message_id = ?").all(messageId) as DbAttachment[];
  }
}

// === Pins ===

export class PinRepo {
  constructor(private db: Database) {}

  pin(roomId: string, messageId: string, pinnedBy: string): void {
    this.db.run(
      "INSERT OR IGNORE INTO pins (room_id, message_id, pinned_by) VALUES (?, ?, ?)",
      [roomId, messageId, pinnedBy]
    );
  }

  unpin(roomId: string, messageId: string): void {
    this.db.run(
      "DELETE FROM pins WHERE room_id = ? AND message_id = ?",
      [roomId, messageId]
    );
  }

  getForRoom(roomId: string): string[] {
    const rows = this.db.query(
      "SELECT message_id FROM pins WHERE room_id = ? ORDER BY created_at"
    ).all(roomId) as { message_id: string }[];
    return rows.map((r) => r.message_id);
  }
}

// === Events ===

export interface DbEvent {
  seq: number;
  room_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export class EventRepo {
  constructor(private db: Database) {}

  create(roomId: string, eventType: string, payload: unknown): DbEvent {
    this.db.run(
      "INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)",
      [roomId, eventType, JSON.stringify(payload)]
    );
    const lastId = this.db.query("SELECT last_insert_rowid() as seq").get() as { seq: number };
    return this.db.query("SELECT * FROM events WHERE seq = ?").get(lastId.seq) as DbEvent;
  }

  getSince(roomId: string, sinceSeq: number, limit: number = 100): DbEvent[] {
    return this.db.query(
      "SELECT * FROM events WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?"
    ).all(roomId, sinceSeq, limit) as DbEvent[];
  }
}
