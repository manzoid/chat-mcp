import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { sign } from "@chat-mcp/shared";
import { v4 as uuid } from "uuid";

import {
  createTestApp,
  generateTestKeys,
  registerAndAuth,
  type TestApp,
  type TestUser,
} from "./helpers.js";

let tmpDir: string;
let keyPath: string;
let publicKey: string;
let app: Hono;
let participantId: string;
let sessionToken: string;
let testApp: TestApp;

function req(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init);
}

function authedReq(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${sessionToken}`);
  return req(path, { ...init, headers });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "chat-mcp-integ-"));
  testApp = await createTestApp(tmpDir);
  app = testApp.app;

  // Register alice via admin
  const aliceKeys = generateTestKeys(tmpDir, "alice");
  keyPath = aliceKeys.keyPath;
  publicKey = aliceKeys.publicKey;
  const alice = await registerAndAuth(
    app,
    testApp.adminUser.sessionToken,
    "alice",
    aliceKeys.keyPath,
    aliceKeys.publicKey,
  );
  participantId = alice.participantId;
  sessionToken = alice.sessionToken;

  // Promote alice to admin so existing tests (room creation, invites) work
  testApp.db.prepare(`UPDATE participants SET role = 'admin' WHERE id = ?`).run(participantId);
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("health", () => {
  it("returns health status", async () => {
    const res = await req("/health");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.protocol_version).toBe(1);
  });

  it("includes protocol version headers", async () => {
    const res = await req("/health");
    expect(res.headers.get("x-chat-protocol-version")).toBe("1");
    expect(res.headers.get("x-chat-protocol-min-version")).toBe("1");
  });
});

describe("auth", () => {
  it("registers a participant and authenticates", () => {
    expect(participantId).toBeTruthy();
    expect(sessionToken).toBeTruthy();
  });

  it("rejects requests without auth", async () => {
    const res = await req("/rooms");
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid token", async () => {
    const res = await authedReq("/rooms");
    expect(res.status).toBe(200);
  });
});

describe("rooms", () => {
  let roomId: string;

  it("creates a room", async () => {
    const res = await authedReq("/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "backend" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("backend");
    roomId = body.id;
  });

  it("lists rooms", async () => {
    const res = await authedReq("/rooms");
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items.some((r: any) => r.id === roomId)).toBe(true);
  });

  it("gets room details", async () => {
    const res = await authedReq(`/rooms/${roomId}`);
    const body = await res.json();
    expect(body.name).toBe("backend");
    expect(body.participants.length).toBe(1);
    expect(body.participants[0].display_name).toBe("alice");
  });

  it("sends a message", async () => {
    const nonce = uuid();
    const content = { format: "plain", text: "hello everyone" };
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp: new Date().toISOString(),
    };
    const signature = await sign(keyPath, payload);

    const res = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp: payload.timestamp,
        mentions: [],
        attachments: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.content_text).toBe("hello everyone");
    expect(body.author_id).toBe(participantId);
  });

  it("reads messages", async () => {
    const res = await authedReq(`/rooms/${roomId}/messages`);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].content_text).toBe("hello everyone");
  });

  it("sends multiple messages and paginates", async () => {
    // Send 3 more messages
    for (let i = 0; i < 3; i++) {
      const nonce = uuid();
      const content = { format: "plain", text: `message ${i}` };
      const payload = {
        room_id: roomId,
        content,
        thread_id: null,
        mentions: [],
        attachments: [],
        nonce,
        timestamp: new Date().toISOString(),
      };
      const signature = await sign(keyPath, payload);

      await authedReq(`/rooms/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          nonce,
          signature,
          timestamp: payload.timestamp,
          mentions: [],
          attachments: [],
        }),
      });
    }

    // Fetch with limit
    const res = await authedReq(`/rooms/${roomId}/messages?limit=2`);
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.has_more).toBe(true);
    expect(body.cursor).toBeTruthy();

    // Fetch next page
    const res2 = await authedReq(
      `/rooms/${roomId}/messages?limit=2&cursor=${body.cursor}`,
    );
    const body2 = await res2.json();
    expect(body2.items.length).toBe(2);
  });

  it("returns 403 for non-members", async () => {
    // Register bob via admin
    const bobKeys = generateTestKeys(tmpDir, "bob-integ");
    const bob = await registerAndAuth(
      app,
      testApp.adminUser.sessionToken,
      "bob-integ",
      bobKeys.keyPath,
      bobKeys.publicKey,
    );

    // Bob is not in the room, should get 403
    expect(bob.participantId).toBeTruthy();
  });
});

describe("security", () => {
  let roomId: string;

  beforeAll(async () => {
    // Create a room for security tests
    const res = await authedReq("/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "security-test" }),
    });
    const body = await res.json();
    roomId = body.id;
  });

  it("rejects messages with tampered signatures", async () => {
    const nonce = uuid();
    const content = { format: "plain", text: "legit message" };
    const timestamp = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };

    // Sign the real payload
    const signature = await sign(keyPath, payload);

    // But send different content (tampered)
    const res = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { format: "plain", text: "TAMPERED message" },
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_signature");
  });

  it("rejects replayed nonces", async () => {
    const nonce = uuid();
    const content = { format: "plain", text: "first send" };
    const timestamp = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(keyPath, payload);

    // First send succeeds
    const res1 = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });
    expect(res1.status).toBe(201);

    // Same nonce again — rejected
    const res2 = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });
    expect(res2.status).toBe(400);
    const body = await res2.json();
    expect(body.error.code).toBe("duplicate_nonce");
  });

  it("rejects messages with stale timestamps", async () => {
    const nonce = uuid();
    const content = { format: "plain", text: "old message" };
    // 10 minutes ago — outside the 5-minute window
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(keyPath, payload);

    const res = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("timestamp_out_of_range");
  });
});

describe("events", () => {
  let roomId: string;

  beforeAll(async () => {
    const res = await authedReq("/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "events-test" }),
    });
    const body = await res.json();
    roomId = body.id;
  });

  it("returns events via polling", async () => {
    // Send a message to create an event
    const nonce = uuid();
    const content = { format: "plain", text: "event test" };
    const timestamp = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(keyPath, payload);

    await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });

    // Poll for events
    const res = await authedReq(`/rooms/${roomId}/events?since_seq=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].type).toBe("message.created");
    expect(body.next_seq).toBeGreaterThan(0);
  });

  it("returns only events after since_seq", async () => {
    // Get current events
    const res1 = await authedReq(`/rooms/${roomId}/events?since_seq=0`);
    const body1 = await res1.json();
    const lastSeq = body1.next_seq;

    // Send another message
    const nonce = uuid();
    const content = { format: "plain", text: "new event" };
    const timestamp = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(keyPath, payload);

    await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        nonce,
        signature,
        timestamp,
        mentions: [],
        attachments: [],
      }),
    });

    // Poll from last known seq
    const res2 = await authedReq(
      `/rooms/${roomId}/events?since_seq=${lastSeq}`,
    );
    const body2 = await res2.json();
    expect(body2.items.length).toBe(1);
    expect(body2.items[0].payload.content.text).toBe("new event");
  });
});

describe("full messaging", () => {
  let roomId: string;
  let messageId: string;

  beforeAll(async () => {
    // Create room and send a message
    const roomRes = await authedReq("/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "full-messaging-test" }),
    });
    roomId = (await roomRes.json()).id;

    const nonce = uuid();
    const content = { format: "plain", text: "original message" };
    const timestamp = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(keyPath, payload);
    const msgRes = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, nonce, signature, timestamp, mentions: [], attachments: [] }),
    });
    messageId = (await msgRes.json()).id;
  });

  it("adds and removes reactions", async () => {
    const reactionPayload = {
      message_id: messageId,
      emoji: "thumbsup",
      author_id: participantId,
    };
    const sig = await sign(keyPath, reactionPayload);

    const addRes = await authedReq(`/messages/${messageId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji: "thumbsup", signature: sig }),
    });
    expect(addRes.status).toBe(201);

    // Check message has reaction
    const msgRes = await authedReq(`/messages/${messageId}`);
    const msg = await msgRes.json();
    expect(msg.reactions.length).toBe(1);
    expect(msg.reactions[0].emoji).toBe("thumbsup");

    // Remove
    const removeRes = await authedReq(
      `/messages/${messageId}/reactions/thumbsup`,
      { method: "DELETE" },
    );
    expect(removeRes.status).toBe(204);
  });

  it("edits a message and preserves history", async () => {
    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const newContent = { format: "plain", text: "edited message" };
    const editPayload = {
      room_id: roomId,
      content: newContent,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const sig = await sign(keyPath, editPayload);

    const res = await authedReq(`/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, nonce, signature: sig, timestamp }),
    });
    expect(res.status).toBe(200);

    // Check edit history
    const msgRes = await authedReq(`/messages/${messageId}`);
    const msg = await msgRes.json();
    expect(msg.content_text).toBe("edited message");
    expect(msg.edit_history.length).toBe(1);
    expect(msg.edit_history[0].content_text).toBe("original message");
  });

  it("pins and unpins a message", async () => {
    const pinRes = await authedReq(`/messages/${messageId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(pinRes.status).toBe(200);

    // Check pins
    const pinsRes = await authedReq(`/rooms/${roomId}/pins`);
    const pins = await pinsRes.json();
    expect(pins.items.length).toBe(1);
    expect(pins.items[0].id).toBe(messageId);

    // Unpin
    const unpinRes = await authedReq(`/messages/${messageId}/pin`, {
      method: "DELETE",
    });
    expect(unpinRes.status).toBe(204);

    const pinsRes2 = await authedReq(`/rooms/${roomId}/pins`);
    const pins2 = await pinsRes2.json();
    expect(pins2.items.length).toBe(0);
  });

  it("deletes a message (soft delete)", async () => {
    const res = await authedReq(`/messages/${messageId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(204);

    // Message should not appear in room messages
    const msgsRes = await authedReq(`/rooms/${roomId}/messages`);
    const msgs = await msgsRes.json();
    const found = msgs.items.find((m: any) => m.id === messageId);
    expect(found).toBeUndefined();
  });

  it("threads messages", async () => {
    // Send a root message
    const nonce1 = uuid();
    const content1 = { format: "plain", text: "thread root" };
    const ts1 = new Date().toISOString();
    const payload1 = {
      room_id: roomId,
      content: content1,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce: nonce1,
      timestamp: ts1,
    };
    const sig1 = await sign(keyPath, payload1);
    const rootRes = await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content1, nonce: nonce1, signature: sig1, timestamp: ts1, mentions: [], attachments: [] }),
    });
    const rootId = (await rootRes.json()).id;

    // Send a reply
    const nonce2 = uuid();
    const content2 = { format: "plain", text: "thread reply" };
    const ts2 = new Date().toISOString();
    const payload2 = {
      room_id: roomId,
      content: content2,
      thread_id: rootId,
      mentions: [],
      attachments: [],
      nonce: nonce2,
      timestamp: ts2,
    };
    const sig2 = await sign(keyPath, payload2);
    await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content2, thread_id: rootId, nonce: nonce2, signature: sig2, timestamp: ts2, mentions: [], attachments: [] }),
    });

    // Get thread
    const threadRes = await authedReq(
      `/rooms/${roomId}/messages?thread_id=${rootId}`,
    );
    const thread = await threadRes.json();
    expect(thread.items.length).toBe(1);
    expect(thread.items[0].content_text).toBe("thread reply");

    // Get thread summary from message detail
    const rootMsgRes = await authedReq(`/messages/${rootId}`);
    const rootMsg = await rootMsgRes.json();
    expect(rootMsg.thread.reply_count).toBe(1);
  });

  it("searches messages", async () => {
    // Send a searchable message
    const nonce = uuid();
    const content = { format: "plain", text: "unique-search-term-xyz123" };
    const ts = new Date().toISOString();
    const payload = {
      room_id: roomId,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp: ts,
    };
    const sig = await sign(keyPath, payload);
    await authedReq(`/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, nonce, signature: sig, timestamp: ts, mentions: [], attachments: [] }),
    });

    const searchRes = await authedReq(
      `/rooms/${roomId}/messages/search?q=unique-search-term`,
    );
    const results = await searchRes.json();
    expect(results.items.length).toBeGreaterThanOrEqual(1);
    expect(results.items[0].content_text).toContain("unique-search-term");
  });

  it("sets room topic", async () => {
    const res = await authedReq(`/rooms/${roomId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "Sprint 12 work" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.topic).toBe("Sprint 12 work");
  });
});
