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

describe("SSE stream", () => {
  test("non-member gets 403", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();
    const res = await req("GET", `/rooms/${room.id}/stream`, undefined, "p2");
    expect(res.status).toBe(403);
  });

  test("SSE endpoint returns event-stream content type", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();

    // Use AbortController to cancel after getting headers
    const controller = new AbortController();
    const resPromise = app.request(`/rooms/${room.id}/stream`, {
      headers: {
        "Content-Type": "application/json",
        "X-Participant-Id": "p1",
      },
      signal: controller.signal,
    });

    const res = await resPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    controller.abort();
  });

  test("SSE delivers events for room mutations", async () => {
    const roomRes = await req("POST", "/rooms", { name: "test" });
    const room = await roomRes.json();
    await req("POST", `/rooms/${room.id}/invite`, { participant_id: "p2" });

    // Connect to SSE
    const controller = new AbortController();
    const res = await app.request(`/rooms/${room.id}/stream`, {
      headers: {
        "Content-Type": "application/json",
        "X-Participant-Id": "p1",
      },
      signal: controller.signal,
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial keepalive
    const { value: keepalive } = await reader.read();
    expect(decoder.decode(keepalive)).toContain(":ok");

    // Send a message (which creates an event)
    await req("POST", `/rooms/${room.id}/messages`, {
      content: { format: "markdown", text: "Hello SSE!" },
      signature: "sig1",
      nonce: "nonce1",
    });

    // Read the SSE event
    const { value: eventData } = await reader.read();
    const text = decoder.decode(eventData);
    expect(text).toContain("data:");
    expect(text).toContain("message.created");

    controller.abort();
  });
});
