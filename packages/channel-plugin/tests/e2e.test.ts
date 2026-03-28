import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "../../server/src/db/connection";
import { createApp } from "../../server/src/app";
import { Database } from "bun:sqlite";
import { Subprocess } from "bun";

/**
 * End-to-end test: starts a real HTTP server, spawns the channel plugin,
 * and tests MCP tool calls flowing through to the server.
 */

let db: Database;
let httpServer: ReturnType<typeof Bun.serve>;
let port: number;

beforeEach(() => {
  db = createDatabase(":memory:");
  const { app } = createApp(db);

  // Start real HTTP server
  httpServer = Bun.serve({
    port: 0, // Random available port
    fetch: app.fetch,
  });
  port = httpServer.port;

  // Create test participants
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

  // Create a room with both participants
  db.run("INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)", ["room1", "backend", "human1"]);
  db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", "human1", "human1"]);
  db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", "agent1", "human1"]);
});

afterEach(() => {
  httpServer?.stop();
});

async function mcpCall(method: string, params: any, id: number = 1): Promise<any> {
  const proc = Bun.spawn(["bun", "run", "packages/channel-plugin/src/index.ts"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      CHAT_SERVER_URL: `http://localhost:${port}`,
      CHAT_PARTICIPANT_ID: "agent1",
      CHAT_ROOM_IDS: "", // No SSE for these tests
    },
  });

  // Send initialize first, then the actual call
  const initMsg = JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) + "\n";
  const callMsg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

  proc.stdin.write(initMsg);
  proc.stdin.write(callMsg);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const lines = output.trim().split("\n");
  proc.kill();

  // Return the response to our call (second line)
  if (lines.length >= 2) {
    return JSON.parse(lines[1]);
  }
  return JSON.parse(lines[0]);
}

describe("e2e: channel plugin → server", () => {
  test("chat_reply sends a message through to the server", async () => {
    const result = await mcpCall("tools/call", {
      name: "chat_reply",
      arguments: { room_id: "room1", text: "Hello from the agent!" },
    });

    expect(result.result.content[0].text).toContain("Message sent:");

    // Verify the message exists in DB
    const msg = db.query("SELECT * FROM messages WHERE author_id = 'agent1'").get() as any;
    expect(msg).toBeTruthy();
    expect(msg.content_text).toBe("Hello from the agent!");
  });

  test("chat_get_history retrieves messages", async () => {
    // Insert a message directly
    db.run(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, signature, nonce)
       VALUES ('msg1', 'room1', 'human1', 'markdown', 'Can you check the tests?', 'sig1', 'n1')`
    );

    const result = await mcpCall("tools/call", {
      name: "chat_get_history",
      arguments: { room_id: "room1" },
    });

    expect(result.result.content[0].text).toContain("Can you check the tests?");
  });

  test("chat_search finds matching messages", async () => {
    // Insert messages and update FTS
    db.run(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, signature, nonce)
       VALUES ('msg1', 'room1', 'human1', 'markdown', 'The payment endpoint uses Stripe', 'sig1', 'n1')`
    );
    db.run(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, signature, nonce)
       VALUES ('msg2', 'room1', 'human1', 'markdown', 'Auth module is complete', 'sig2', 'n2')`
    );

    const result = await mcpCall("tools/call", {
      name: "chat_search",
      arguments: { room_id: "room1", query: "payment" },
    });

    expect(result.result.content[0].text).toContain("payment");
    expect(result.result.content[0].text).not.toContain("Auth module");
  });

  test("chat_list_rooms shows agent's rooms", async () => {
    const result = await mcpCall("tools/call", {
      name: "chat_list_rooms",
      arguments: {},
    });

    expect(result.result.content[0].text).toContain("backend");
    expect(result.result.content[0].text).toContain("room1");
  });

  test("chat_set_status updates agent presence", async () => {
    const result = await mcpCall("tools/call", {
      name: "chat_set_status",
      arguments: { state: "busy", description: "running tests" },
    });

    expect(result.result.content[0].text).toContain("busy");

    // Verify in DB
    const presence = db.query("SELECT * FROM presence WHERE participant_id = 'agent1'").get() as any;
    expect(presence.state).toBe("busy");
  });

  test("chat_react adds reaction to message", async () => {
    db.run(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, signature, nonce)
       VALUES ('msg1', 'room1', 'human1', 'markdown', 'Great work!', 'sig1', 'n1')`
    );

    const result = await mcpCall("tools/call", {
      name: "chat_react",
      arguments: { message_id: "msg1", emoji: "🎉" },
    });

    expect(result.result.content[0].text).toContain("🎉");

    // Verify reaction in DB
    const reaction = db.query("SELECT * FROM reactions WHERE message_id = 'msg1'").get() as any;
    expect(reaction.emoji).toBe("🎉");
    expect(reaction.author_id).toBe("agent1");
  });

  test("chat_room_members lists room participants", async () => {
    const result = await mcpCall("tools/call", {
      name: "chat_room_members",
      arguments: { room_id: "room1" },
    });

    const text = result.result.content[0].text;
    expect(text).toContain("alice");
    expect(text).toContain("claude-alice");
  });
});
