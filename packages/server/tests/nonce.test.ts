import { describe, test, expect, beforeEach } from "bun:test";
import { createDatabase } from "../src/db/connection";
import { createApp } from "../src/app";
import { Database } from "bun:sqlite";

let db: Database;
let app: ReturnType<typeof createApp>["app"];

function req(method: string, path: string, body?: any, participantId: string = "p1") {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Participant-Id": participantId,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

beforeEach(() => {
  db = createDatabase(":memory:");
  const result = createApp(db, { enforceNonces: true });
  app = result.app;
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["p1", "alice", "human", "key1"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["p1"]);
  db.run("INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)", ["room1", "test", "p1"]);
  db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", "p1", "p1"]);
});

describe("nonce enforcement", () => {
  test("accepts message with unique nonce", async () => {
    const res = await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "Hello" },
      signature: "sig1",
      nonce: "unique-nonce-1",
    });
    expect(res.status).toBe(201);
  });

  test("rejects duplicate nonce (replay attack prevention)", async () => {
    await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "Hello" },
      signature: "sig1",
      nonce: "reused-nonce",
    });

    const res = await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "Replay!" },
      signature: "sig2",
      nonce: "reused-nonce",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("duplicate_nonce");
  });

  test("different nonces are accepted", async () => {
    const r1 = await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "First" },
      signature: "sig1",
      nonce: "nonce-a",
    });
    expect(r1.status).toBe(201);

    const r2 = await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "Second" },
      signature: "sig2",
      nonce: "nonce-b",
    });
    expect(r2.status).toBe(201);
  });
});
