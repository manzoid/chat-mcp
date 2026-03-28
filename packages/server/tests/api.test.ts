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
  const result = createApp(db);
  app = result.app;
  // Create test participants directly
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["p1", "alice", "human", "key1"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["p1"]);
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["p2", "bob", "human", "key2"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["p2"]);
});

describe("health", () => {
  test("GET /health", async () => {
    const res = await req("GET", "/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

describe("participants", () => {
  test("POST /auth/register creates a participant", async () => {
    const res = await req("POST", "/auth/register", {
      display_name: "charlie",
      type: "human",
      public_key_pem: "key3",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.display_name).toBe("charlie");
    expect(body.id).toBeTruthy();
  });

  test("duplicate display name returns 409", async () => {
    const res = await req("POST", "/auth/register", {
      display_name: "alice",
      type: "human",
      public_key_pem: "key-dup",
    });
    expect(res.status).toBe(409);
  });

  test("GET /participants/:id", async () => {
    const res = await req("GET", "/participants/p1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("alice");
    expect(body.status.state).toBe("online");
  });

  test("POST /participants/me/status", async () => {
    await req("POST", "/participants/me/status", {
      state: "busy",
      description: "working on auth",
    });
    const res = await req("GET", "/participants/p1");
    const body = await res.json();
    expect(body.status.state).toBe("busy");
    expect(body.status.description).toBe("working on auth");
  });
});

describe("rooms", () => {
  test("create, list, get room", async () => {
    const createRes = await req("POST", "/rooms", { name: "backend" });
    expect(createRes.status).toBe(201);
    const room = await createRes.json();
    expect(room.name).toBe("backend");

    const listRes = await req("GET", "/rooms");
    const list = await listRes.json();
    expect(list.data.length).toBe(1);

    const getRes = await req("GET", `/rooms/${room.id}`);
    const got = await getRes.json();
    expect(got.name).toBe("backend");
    expect(got.participants).toContain("p1");
  });

  test("invite and membership", async () => {
    const createRes = await req("POST", "/rooms", { name: "test-room" });
    const room = await createRes.json();

    // p2 can't see the room
    const listRes = await req("GET", "/rooms", undefined, "p2");
    const list = await listRes.json();
    expect(list.data.length).toBe(0);

    // p1 invites p2
    await req("POST", `/rooms/${room.id}/invite`, { participant_id: "p2" });

    // Now p2 can see it
    const listRes2 = await req("GET", "/rooms", undefined, "p2");
    const list2 = await listRes2.json();
    expect(list2.data.length).toBe(1);
  });

  test("non-member gets 403", async () => {
    const createRes = await req("POST", "/rooms", { name: "private" });
    const room = await createRes.json();
    const res = await req("GET", `/rooms/${room.id}`, undefined, "p2");
    expect(res.status).toBe(403);
  });

  test("set topic", async () => {
    const createRes = await req("POST", "/rooms", { name: "backend" });
    const room = await createRes.json();
    await req("PUT", `/rooms/${room.id}/topic`, { topic: "Sprint 12" });
    const getRes = await req("GET", `/rooms/${room.id}`);
    const got = await getRes.json();
    expect(got.topic).toBe("Sprint 12");
  });
});

describe("messages", () => {
  let roomId: string;

  beforeEach(async () => {
    const res = await req("POST", "/rooms", { name: "test" });
    const room = await res.json();
    roomId = room.id;
    // Add p2 to the room
    await req("POST", `/rooms/${roomId}/invite`, { participant_id: "p2" });
  });

  test("send and read messages", async () => {
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Hello everyone!" },
      signature: "sig1",
      nonce: "nonce1",
    });
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Second message" },
      signature: "sig2",
      nonce: "nonce2",
    }, "p2");

    const res = await req("GET", `/rooms/${roomId}/messages`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    // Most recent first
    expect(body.data[0].content.text).toBe("Second message");
    expect(body.data[1].content.text).toBe("Hello everyone!");
  });

  test("threading", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Original" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const parentMsg = await msgRes.json();

    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Reply 1" },
      thread_id: parentMsg.id,
      signature: "sig2",
      nonce: "nonce2",
    });
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Reply 2" },
      thread_id: parentMsg.id,
      signature: "sig3",
      nonce: "nonce3",
    });

    const res = await req("GET", `/rooms/${roomId}/messages?thread_id=${parentMsg.id}`);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.data[0].content.text).toBe("Reply 1");
  });

  test("edit message", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Original text" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const msg = await msgRes.json();

    const editRes = await req("PATCH", `/messages/${msg.id}`, {
      content: { format: "markdown", text: "Edited text" },
      signature: "sig-edit",
    });
    expect(editRes.status).toBe(200);

    const readRes = await req("GET", `/rooms/${roomId}/messages`);
    const body = await readRes.json();
    expect(body.data[0].content.text).toBe("Edited text");
    expect(body.data[0].edited_at).toBeTruthy();
  });

  test("can't edit someone else's message", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Alice's message" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const msg = await msgRes.json();

    const editRes = await req("PATCH", `/messages/${msg.id}`, {
      content: { format: "markdown", text: "Hacked!" },
      signature: "sig-hack",
    }, "p2");
    expect(editRes.status).toBe(403);
  });

  test("soft delete", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Delete me" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const msg = await msgRes.json();

    await req("DELETE", `/messages/${msg.id}`);

    const readRes = await req("GET", `/rooms/${roomId}/messages`);
    const body = await readRes.json();
    expect(body.data.length).toBe(0);
  });

  test("full-text search", async () => {
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "The payment endpoint uses Stripe" },
      signature: "sig1",
      nonce: "nonce1",
    });
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Auth module is complete" },
      signature: "sig2",
      nonce: "nonce2",
    });

    const res = await req("GET", `/rooms/${roomId}/messages/search?q=payment`);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].content_text).toContain("payment");
  });
});

describe("reactions", () => {
  let roomId: string;
  let msgId: string;

  beforeEach(async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();
    roomId = room.id;
    await req("POST", `/rooms/${roomId}/invite`, { participant_id: "p2" });

    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "React to this" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const msg = await msgRes.json();
    msgId = msg.id;
  });

  test("add and see reactions", async () => {
    await req("POST", `/messages/${msgId}/reactions`, {
      emoji: "👍",
      signature: "rsig1",
    });
    await req("POST", `/messages/${msgId}/reactions`, {
      emoji: "❤️",
      signature: "rsig2",
    }, "p2");

    const res = await req("GET", `/rooms/${roomId}/messages`);
    const body = await res.json();
    expect(body.data[0].reactions.length).toBe(2);
  });

  test("remove reaction", async () => {
    await req("POST", `/messages/${msgId}/reactions`, {
      emoji: "👍",
      signature: "rsig1",
    });
    await req("DELETE", `/messages/${msgId}/reactions/👍`);

    const res = await req("GET", `/rooms/${roomId}/messages`);
    const body = await res.json();
    expect(body.data[0].reactions.length).toBe(0);
  });
});

describe("pins", () => {
  test("pin and list pins", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();
    const msgRes = await req("POST", `/rooms/${room.id}/messages`, {
      content: { format: "markdown", text: "Important decision" },
      signature: "sig1",
      nonce: "nonce1",
    });
    const msg = await msgRes.json();

    await req("POST", `/messages/${msg.id}/pin`);

    const pinsRes = await req("GET", `/rooms/${room.id}/pins`);
    const pins = await pinsRes.json();
    expect(pins.data).toContain(msg.id);

    // Unpin
    await req("DELETE", `/messages/${msg.id}/pin`);
    const pinsRes2 = await req("GET", `/rooms/${room.id}/pins`);
    const pins2 = await pinsRes2.json();
    expect(pins2.data.length).toBe(0);
  });
});

describe("events", () => {
  test("events are created for mutations", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();

    await req("POST", `/rooms/${room.id}/messages`, {
      content: { format: "markdown", text: "Hello" },
      signature: "sig1",
      nonce: "nonce1",
    });

    const eventsRes = await req("GET", `/rooms/${room.id}/events?since_seq=0`);
    const events = await eventsRes.json();
    // room.created + message.created
    expect(events.data.length).toBeGreaterThanOrEqual(2);
    const types = events.data.map((e: any) => e.event_type);
    expect(types).toContain("room.created");
    expect(types).toContain("message.created");
  });

  test("since_seq filters correctly", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();

    await req("POST", `/rooms/${room.id}/messages`, {
      content: { format: "markdown", text: "First" },
      signature: "sig1",
      nonce: "nonce1",
    });

    const eventsRes = await req("GET", `/rooms/${room.id}/events?since_seq=0`);
    const events = await eventsRes.json();
    const maxSeq = Math.max(...events.data.map((e: any) => e.seq));

    await req("POST", `/rooms/${room.id}/messages`, {
      content: { format: "markdown", text: "Second" },
      signature: "sig2",
      nonce: "nonce2",
    });

    const newEventsRes = await req("GET", `/rooms/${room.id}/events?since_seq=${maxSeq}`);
    const newEvents = await newEventsRes.json();
    expect(newEvents.data.length).toBe(1);
    expect(newEvents.data[0].event_type).toBe("message.created");
  });
});
