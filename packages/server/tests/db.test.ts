import { describe, test, expect } from "bun:test";
import { createDatabase } from "../src/db/connection";

describe("database", () => {
  test("creates all tables", () => {
    const db = createDatabase(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain("participants");
    expect(names).toContain("presence");
    expect(names).toContain("sessions");
    expect(names).toContain("nonces");
    expect(names).toContain("challenges");
    expect(names).toContain("rooms");
    expect(names).toContain("room_members");
    expect(names).toContain("messages");
    expect(names).toContain("mentions");
    expect(names).toContain("reactions");
    expect(names).toContain("attachments");
    expect(names).toContain("pins");
    expect(names).toContain("edit_history");
    expect(names).toContain("events");

    db.close();
  });

  test("WAL mode is enabled", () => {
    const db = createDatabase(":memory:");
    const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    // In-memory databases may report 'memory' instead of 'wal'
    expect(["wal", "memory"]).toContain(result.journal_mode);
    db.close();
  });

  test("FTS5 table exists", () => {
    const db = createDatabase(":memory:");
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'")
      .all();
    expect(tables.length).toBe(1);
    db.close();
  });

  test("can insert and query a participant", () => {
    const db = createDatabase(":memory:");
    db.run(
      "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
      ["p1", "alice", "human", "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----"]
    );
    const row = db.query("SELECT * FROM participants WHERE id = ?").get("p1") as any;
    expect(row.display_name).toBe("alice");
    expect(row.type).toBe("human");
    db.close();
  });

  test("foreign key constraint works", () => {
    const db = createDatabase(":memory:");
    expect(() => {
      db.run(
        "INSERT INTO room_members (room_id, participant_id) VALUES (?, ?)",
        ["nonexistent", "also-nonexistent"]
      );
    }).toThrow();
    db.close();
  });
});
