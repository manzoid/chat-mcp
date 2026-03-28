import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "../../server/src/db/connection";
import { createApp } from "../../server/src/app";
import { Database } from "bun:sqlite";

/**
 * CLI integration tests: spawn the CLI binary against a real HTTP server
 * to test the full command pipeline.
 */

let db: Database;
let httpServer: ReturnType<typeof Bun.serve>;
let port: number;

beforeEach(() => {
  db = createDatabase(":memory:");
  const { app } = createApp(db);
  httpServer = Bun.serve({ port: 0, fetch: app.fetch });
  port = httpServer.port;

  // Seed test participants
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["user1", "alice", "human", "key1"]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["user1"]);
});

afterEach(() => {
  httpServer?.stop();
});

async function runCli(args: string[], participantId = "user1"): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(
    ["bun", "run", "packages/cli/src/index.ts", ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Override config via env-based approach — we'll create a temp config
        HOME: "/tmp/chat-mcp-test-" + Date.now(),
      },
    }
  );

  // Pre-create config for the CLI
  const configDir = `/tmp/chat-mcp-test-${Date.now()}/.config/chat-mcp`;

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// Helper that uses direct app.request (faster, no process spawn)
function req(method: string, path: string, body?: any, participantId = "user1") {
  const { app } = createApp(db);
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Participant-Id": participantId,
    },
  };
  if (body) init.body = JSON.stringify(body);
  // Use the same app from createApp since db is shared
  return app;
}

describe("CLI config", () => {
  test("config show works with default config", async () => {
    const result = await runCli(["config", "show"]);
    expect(result.stdout).toContain("server_url");
  });
});

describe("CLI commands against server", () => {
  // These tests use the ChatApiClient directly against the test server
  // to validate the same code paths the CLI uses

  test("room create flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("test-room");
    expect(room.name).toBe("test-room");
    expect(room.id).toBeTruthy();

    const { data: rooms } = await client.listRooms();
    expect(rooms.length).toBe(1);
    expect(rooms[0].name).toBe("test-room");
  });

  test("message send/read flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("msg-test");
    const msg = await client.sendMessage(room.id, "Hello from CLI test!");

    expect(msg.id).toBeTruthy();

    const { data: messages } = await client.getMessages(room.id);
    expect(messages.length).toBe(1);
    expect(messages[0].content.text).toBe("Hello from CLI test!");
  });

  test("search flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("search-test");
    await client.sendMessage(room.id, "The Stripe webhook handler is broken");
    await client.sendMessage(room.id, "Database migration completed");

    const { data } = await client.searchMessages(room.id, "Stripe");
    expect(data.length).toBe(1);
    expect(data[0].content_text).toContain("Stripe");
  });

  test("reaction flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("react-test");
    const msg = await client.sendMessage(room.id, "Great work!");
    await client.addReaction(msg.id, "🎉");

    const { data } = await client.getMessages(room.id);
    expect(data[0].reactions.length).toBe(1);
    expect(data[0].reactions[0].emoji).toBe("🎉");

    await client.removeReaction(msg.id, "🎉");
    const { data: after } = await client.getMessages(room.id);
    expect(after[0].reactions.length).toBe(0);
  });

  test("edit/delete flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("edit-test");
    const msg = await client.sendMessage(room.id, "Orignal text");
    await client.editMessage(msg.id, "Original text (fixed)");

    const { data: edited } = await client.getMessages(room.id);
    expect(edited[0].content.text).toBe("Original text (fixed)");

    await client.deleteMessage(msg.id);
    const { data: afterDelete } = await client.getMessages(room.id);
    expect(afterDelete.length).toBe(0);
  });

  test("pin flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("pin-test");
    const msg = await client.sendMessage(room.id, "Pin this!");
    await client.pinMessage(msg.id);

    const pins = await client.getPins(room.id);
    expect(pins.data).toContain(msg.id);

    await client.unpinMessage(msg.id);
    const pinsAfter = await client.getPins(room.id);
    expect(pinsAfter.data.length).toBe(0);
  });

  test("status flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    await client.setStatus("busy", "in a meeting");
    const p = await client.getParticipant("user1");
    expect(p.status.state).toBe("busy");
    expect(p.status.description).toBe("in a meeting");
  });

  test("thread flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("thread-test");
    const parent = await client.sendMessage(room.id, "Design question");
    await client.sendMessage(room.id, "Use the factory pattern", { thread_id: parent.id });
    await client.sendMessage(room.id, "Agreed", { thread_id: parent.id });

    const { data: thread } = await client.getMessages(room.id, { thread_id: parent.id });
    expect(thread.length).toBe(2);
    expect(thread[0].content.text).toBe("Use the factory pattern");
  });

  test("events flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");
    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("events-test");
    await client.sendMessage(room.id, "trigger event");

    const events = await client.getEvents(room.id, 0);
    const types = events.data.map((e: any) => e.event_type);
    expect(types).toContain("room.created");
    expect(types).toContain("message.created");
  });

  test("room invite and topic flow via API (CLI code path)", async () => {
    const { ChatApiClient } = await import("@chat-mcp/shared");

    // Create second participant
    db.run(
      "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
      ["user2", "bob", "human", "key2"]
    );
    db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["user2"]);

    const client = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "user1",
    });

    const room = await client.createRoom("collab-room");
    await client.invite(room.id, "user2");
    await client.setTopic(room.id, "Sprint 14 planning");

    const roomInfo = await client.getRoom(room.id);
    expect(roomInfo.topic).toBe("Sprint 14 planning");
    expect(roomInfo.participants).toContain("user2");

    const { data: members } = await client.getParticipants(room.id);
    const names = members.map((m: any) => m.display_name);
    expect(names).toContain("alice");
    expect(names).toContain("bob");
  });
});
