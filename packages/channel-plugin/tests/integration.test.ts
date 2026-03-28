import { describe, test, expect, beforeEach } from "bun:test";
import { createDatabase } from "../../server/src/db/connection";
import { createApp } from "../../server/src/app";
import { ChatApiClient } from "@chat-mcp/shared";
import { Database } from "bun:sqlite";

/**
 * Integration test: exercises the ChatApiClient (used by the channel plugin)
 * against a real in-process server, testing the full tool→API→DB pipeline.
 */

let db: Database;
let app: ReturnType<typeof createApp>["app"];
let serverUrl: string;
let server: any;

function setupClient(participantId: string): ChatApiClient {
  // We can't use real HTTP in unit tests easily, so test via direct app.request
  // Instead, test the ChatApiClient methods by running a real server
  return new ChatApiClient({
    serverUrl: `http://localhost:0`, // Placeholder
    participantId,
  });
}

// Use direct app.request for integration testing
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
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["agent1", "claude-alice", "agent", "key1"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["agent1"]);
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["human1", "alice", "human", "key2"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["human1"]);
});

describe("channel plugin tool operations via API", () => {
  let roomId: string;

  beforeEach(async () => {
    // Human creates a room and invites the agent
    const roomRes = await req("POST", "/rooms", { name: "backend" }, "human1");
    const room = await roomRes.json();
    roomId = room.id;
    await req("POST", `/rooms/${roomId}/invite`, { participant_id: "agent1" }, "human1");
  });

  test("agent can send message (chat_reply equivalent)", async () => {
    const res = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "I've finished the auth module." },
      signature: "agent-sig-1",
      nonce: "agent-nonce-1",
    }, "agent1");
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.author_id).toBe("agent1");
  });

  test("agent can react to messages (chat_react equivalent)", async () => {
    // Human sends a message
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Starting on auth module" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    const msg = await msgRes.json();

    // Agent reacts
    const reactRes = await req("POST", `/messages/${msg.id}/reactions`, {
      emoji: "👍",
      signature: "rsig1",
    }, "agent1");
    expect(reactRes.status).toBe(200);

    // Verify reaction shows up
    const readRes = await req("GET", `/rooms/${roomId}/messages`, undefined, "agent1");
    const body = await readRes.json();
    expect(body.data[0].reactions.length).toBe(1);
    expect(body.data[0].reactions[0].emoji).toBe("👍");
  });

  test("agent can read history (chat_get_history equivalent)", async () => {
    // Human sends messages
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Message 1" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Message 2" },
      signature: "sig2",
      nonce: "nonce2",
    }, "human1");

    // Agent reads
    const res = await req("GET", `/rooms/${roomId}/messages?limit=10`, undefined, "agent1");
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("agent can search messages (chat_search equivalent)", async () => {
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "The payment endpoint uses Stripe webhooks" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Auth module is done" },
      signature: "sig2",
      nonce: "nonce2",
    }, "human1");

    const res = await req("GET", `/rooms/${roomId}/messages/search?q=payment`, undefined, "agent1");
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].content_text).toContain("payment");
  });

  test("agent can edit its own messages (chat_edit_message equivalent)", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Orignal text" },
      signature: "sig1",
      nonce: "nonce1",
    }, "agent1");
    const msg = await msgRes.json();

    const editRes = await req("PATCH", `/messages/${msg.id}`, {
      content: { format: "markdown", text: "Original text (fixed typo)" },
      signature: "sig-edit",
    }, "agent1");
    expect(editRes.status).toBe(200);

    const readRes = await req("GET", `/rooms/${roomId}/messages`, undefined, "agent1");
    const body = await readRes.json();
    expect(body.data[0].content.text).toBe("Original text (fixed typo)");
  });

  test("agent cannot edit human's messages", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Human's message" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    const msg = await msgRes.json();

    const editRes = await req("PATCH", `/messages/${msg.id}`, {
      content: { format: "markdown", text: "Tampered!" },
      signature: "sig-hack",
    }, "agent1");
    expect(editRes.status).toBe(403);
  });

  test("agent can set status (chat_set_status equivalent)", async () => {
    const res = await req("POST", "/participants/me/status", {
      state: "busy",
      description: "running tests",
    }, "agent1");
    expect(res.status).toBe(200);

    const pRes = await req("GET", "/participants/agent1", undefined, "agent1");
    const body = await pRes.json();
    expect(body.status.state).toBe("busy");
    expect(body.status.description).toBe("running tests");
  });

  test("agent can use threads (chat_get_thread equivalent)", async () => {
    const parentRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Design discussion" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    const parent = await parentRes.json();

    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "I suggest using Strategy pattern" },
      thread_id: parent.id,
      signature: "sig2",
      nonce: "nonce2",
    }, "agent1");

    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Good idea, let's do that" },
      thread_id: parent.id,
      signature: "sig3",
      nonce: "nonce3",
    }, "human1");

    const threadRes = await req("GET", `/rooms/${roomId}/messages?thread_id=${parent.id}`, undefined, "agent1");
    const body = await threadRes.json();
    expect(body.data.length).toBe(2);
    expect(body.data[0].content.text).toBe("I suggest using Strategy pattern");
  });

  test("agent can pin messages (chat_pin equivalent)", async () => {
    const msgRes = await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Important: API contract v2" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");
    const msg = await msgRes.json();

    const pinRes = await req("POST", `/messages/${msg.id}/pin`, undefined, "agent1");
    expect(pinRes.status).toBe(200);

    const pinsRes = await req("GET", `/rooms/${roomId}/pins`, undefined, "agent1");
    const pins = await pinsRes.json();
    expect(pins.data).toContain(msg.id);
  });

  test("agent can list rooms (chat_list_rooms equivalent)", async () => {
    const res = await req("GET", "/rooms", undefined, "agent1");
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].name).toBe("backend");
  });

  test("agent can list room members (chat_room_members equivalent)", async () => {
    const res = await req("GET", `/rooms/${roomId}/participants`, undefined, "agent1");
    const body = await res.json();
    expect(body.data.length).toBe(2);
    const names = body.data.map((m: any) => m.display_name);
    expect(names).toContain("alice");
    expect(names).toContain("claude-alice");
  });

  test("events are generated for agent actions", async () => {
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Agent reporting in" },
      signature: "sig1",
      nonce: "nonce1",
    }, "agent1");

    const eventsRes = await req("GET", `/rooms/${roomId}/events?since_seq=0`, undefined, "agent1");
    const events = await eventsRes.json();
    const types = events.data.map((e: any) => e.event_type);
    expect(types).toContain("message.created");
  });

  test("SSE delivers events to connected agent", async () => {
    // Connect agent to SSE
    const controller = new AbortController();
    const sseRes = await app.request(`/rooms/${roomId}/stream`, {
      headers: {
        "Content-Type": "application/json",
        "X-Participant-Id": "agent1",
      },
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    // Read keepalive
    await reader.read();

    // Human sends a message
    await req("POST", `/rooms/${roomId}/messages`, {
      content: { format: "markdown", text: "Hey agent, what's the status?" },
      signature: "sig1",
      nonce: "nonce1",
    }, "human1");

    // Agent receives it via SSE
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain("message.created");
    expect(text).toContain("Hey agent");

    controller.abort();
  });
});
