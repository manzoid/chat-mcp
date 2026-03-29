import Database from "better-sqlite3";

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('human', 'agent')),
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('super', 'admin', 'user')),
      paired_with TEXT REFERENCES participants(id),
      status_state TEXT DEFAULT 'offline',
      status_description TEXT,
      status_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS key_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id TEXT NOT NULL REFERENCES participants(id),
      public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      valid_from TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      valid_until TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL REFERENCES participants(id),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      participant_id TEXT NOT NULL REFERENCES participants(id),
      challenge TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      topic TEXT,
      created_by TEXT NOT NULL REFERENCES participants(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      invited_by TEXT REFERENCES participants(id),
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (room_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      author_id TEXT NOT NULL REFERENCES participants(id),
      content_format TEXT NOT NULL DEFAULT 'plain',
      content_text TEXT NOT NULL,
      thread_id TEXT REFERENCES messages(id),
      nonce TEXT NOT NULL,
      sender_timestamp TEXT NOT NULL,
      signature TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      deleted_signature TEXT,
      edited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS mentions (
      message_id TEXT NOT NULL REFERENCES messages(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      PRIMARY KEY (message_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id),
      author_id TEXT NOT NULL REFERENCES participants(id),
      emoji TEXT NOT NULL,
      signature TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (message_id, author_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS edit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL REFERENCES messages(id),
      content_format TEXT NOT NULL,
      content_text TEXT NOT NULL,
      nonce TEXT NOT NULL,
      signature TEXT NOT NULL,
      edited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT REFERENCES messages(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      checksum TEXT,
      uploaded_by TEXT NOT NULL REFERENCES participants(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS pins (
      room_id TEXT NOT NULL REFERENCES rooms(id),
      message_id TEXT NOT NULL REFERENCES messages(id),
      pinned_by TEXT NOT NULL REFERENCES participants(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (room_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL REFERENCES rooms(id),
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS nonces (
      participant_id TEXT NOT NULL REFERENCES participants(id),
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (participant_id, nonce)
    );

    -- Full-text search
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content_text,
      content='messages',
      content_rowid='rowid'
    );

    -- Keep FTS in sync with messages
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content_text ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text) VALUES('delete', old.rowid, old.content_text);
      INSERT INTO messages_fts(rowid, content_text) VALUES (new.rowid, new.content_text);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content_text) VALUES('delete', old.rowid, old.content_text);
    END;

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_events_room_seq ON events(room_id, seq);
    CREATE INDEX IF NOT EXISTS idx_key_history_participant ON key_history(participant_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);
    CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at);

    -- Invite links for registration
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      room_ids TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES participants(id),
      expires_at TEXT,
      used_by TEXT REFERENCES participants(id),
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Migration: add role column to existing databases
  const cols = db.prepare(`PRAGMA table_info(participants)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "role")) {
    db.exec(`ALTER TABLE participants ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  }

  return db;
}
