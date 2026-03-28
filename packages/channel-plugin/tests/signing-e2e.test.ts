import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "../../server/src/db/connection";
import { createApp } from "../../server/src/app";
import { Database } from "bun:sqlite";
import {
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
  signPayload,
  verifyPayload,
  ChatApiClient,
  generateNonce,
  canonicalJsonHash,
  signData,
} from "@chat-mcp/shared";

/**
 * Cross-component signature verification:
 * CLI/client signs → server verifies → plugin verifies locally
 *
 * This is the core trust chain: a message signed by one participant
 * can be verified by the server and independently by any other
 * participant (including channel plugins) using the author's public key.
 */

const aliceKeys = generateKeyPair();
const alicePrivKey = loadPrivateKey(aliceKeys.privateKeyPem);
const alicePubKey = loadPublicKey(aliceKeys.publicKeyPem);

const bobKeys = generateKeyPair();
const bobPrivKey = loadPrivateKey(bobKeys.privateKeyPem);
const bobPubKey = loadPublicKey(bobKeys.publicKeyPem);

let db: Database;
let httpServer: ReturnType<typeof Bun.serve>;
let port: number;

beforeEach(() => {
  // Server with signature verification enabled
  db = createDatabase(":memory:");
  const { app } = createApp(db, { verifySignatures: true });
  httpServer = Bun.serve({ port: 0, fetch: app.fetch });
  port = httpServer.port;

  // Register participants with real public keys
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["alice", "alice-human", "human", aliceKeys.publicKeyPem]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["alice"]);
  db.run(
    "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
    ["bob-agent", "bob-claude", "agent", bobKeys.publicKeyPem]
  );
  db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["bob-agent"]);

  // Create shared room
  db.run("INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)", ["room1", "collab", "alice"]);
  db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", "alice", "alice"]);
  db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", "bob-agent", "alice"]);
});

afterEach(() => {
  httpServer?.stop();
});

describe("cross-component signature verification", () => {
  test("CLI-signed message passes server verification and can be verified by plugin", async () => {
    // Step 1: CLI (alice) signs and sends a message
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
      privateKey: alicePrivKey,
    });

    const msg = await aliceClient.sendMessage("room1", "Design review at 3pm");
    expect(msg.id).toBeTruthy();
    // Server accepted it — signature verified on ingestion

    // Step 2: Plugin (bob) fetches the message and verifies signature locally
    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
    });

    const { data: messages } = await bobClient.getMessages("room1");
    expect(messages.length).toBe(1);
    const received = messages[0];
    expect(received.content.text).toBe("Design review at 3pm");

    // Step 3: Plugin locally verifies the signature using alice's public key
    const signedPayload = {
      room_id: "room1",
      content: { format: "markdown", text: "Design review at 3pm" },
      thread_id: received.thread_id ?? null,
      mentions: received.mentions ?? [],
      attachments: received.attachments?.map((a: any) => a.id) ?? [],
      timestamp: received.timestamp,
      nonce: received.nonce,
    };
    const valid = verifyPayload(alicePubKey, received.signature, signedPayload);
    expect(valid).toBe(true);
  });

  test("agent-signed message passes server verification and can be verified by CLI", async () => {
    // Agent (bob) signs and sends
    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
      privateKey: bobPrivKey,
    });

    const msg = await bobClient.sendMessage("room1", "Tests passing, PR ready");
    expect(msg.id).toBeTruthy();

    // CLI (alice) fetches and verifies locally
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
    });

    const { data: messages } = await aliceClient.getMessages("room1");
    const received = messages[0];

    const signedPayload = {
      room_id: "room1",
      content: { format: "markdown", text: "Tests passing, PR ready" },
      thread_id: received.thread_id ?? null,
      mentions: received.mentions ?? [],
      attachments: received.attachments?.map((a: any) => a.id) ?? [],
      timestamp: received.timestamp,
      nonce: received.nonce,
    };
    const valid = verifyPayload(bobPubKey, received.signature, signedPayload);
    expect(valid).toBe(true);
  });

  test("tampered message fails local verification", async () => {
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
      privateKey: alicePrivKey,
    });

    await aliceClient.sendMessage("room1", "Original message");

    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
    });

    const { data: messages } = await bobClient.getMessages("room1");
    const received = messages[0];

    // Tamper with the content
    const tamperedPayload = {
      room_id: "room1",
      content: { format: "markdown", text: "TAMPERED content" },
      thread_id: received.thread_id ?? null,
      mentions: received.mentions ?? [],
      attachments: received.attachments?.map((a: any) => a.id) ?? [],
      timestamp: received.timestamp,
      nonce: received.nonce,
    };
    const valid = verifyPayload(alicePubKey, received.signature, tamperedPayload);
    expect(valid).toBe(false);
  });

  test("wrong public key fails local verification", async () => {
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
      privateKey: alicePrivKey,
    });

    await aliceClient.sendMessage("room1", "Signed by alice");

    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
    });

    const { data: messages } = await bobClient.getMessages("room1");
    const received = messages[0];

    // Verify with bob's key instead of alice's
    const signedPayload = {
      room_id: "room1",
      content: { format: "markdown", text: "Signed by alice" },
      thread_id: received.thread_id ?? null,
      mentions: received.mentions ?? [],
      attachments: received.attachments?.map((a: any) => a.id) ?? [],
      timestamp: received.timestamp,
      nonce: received.nonce,
    };
    const valid = verifyPayload(bobPubKey, received.signature, signedPayload);
    expect(valid).toBe(false);
  });
});

describe("two-participant full lifecycle e2e", () => {
  test("complete message lifecycle: send, read, react, edit, thread, pin, search, delete", async () => {
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
      privateKey: alicePrivKey,
    });
    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
      privateKey: bobPrivKey,
    });

    // 1. Alice sends a message
    const msg1 = await aliceClient.sendMessage("room1", "Let's discuss the API design");
    expect(msg1.id).toBeTruthy();

    // 2. Bob reads it
    const { data: history } = await bobClient.getMessages("room1");
    expect(history.length).toBe(1);
    expect(history[0].content.text).toBe("Let's discuss the API design");

    // 3. Bob reacts
    await bobClient.addReaction(msg1.id, "👍");
    const { data: withReaction } = await aliceClient.getMessages("room1");
    expect(withReaction[0].reactions.length).toBe(1);
    expect(withReaction[0].reactions[0].emoji).toBe("👍");

    // 4. Bob replies in a thread
    const threadReply = await bobClient.sendMessage("room1", "I suggest REST with JSON:API format", {
      thread_id: msg1.id,
    });
    expect(threadReply.thread_id).toBe(msg1.id);

    // 5. Alice replies in the same thread
    await aliceClient.sendMessage("room1", "Agreed, let's use that", { thread_id: msg1.id });

    // 6. Verify thread
    const { data: thread } = await bobClient.getMessages("room1", { thread_id: msg1.id });
    expect(thread.length).toBe(2);

    // 7. Alice pins the original message
    await aliceClient.pinMessage(msg1.id);
    const pins = await bobClient.getPins("room1");
    expect(pins.data).toContain(msg1.id);

    // 8. Bob edits his thread reply
    await bobClient.editMessage(threadReply.id, "I suggest REST with OpenAPI spec");
    const { data: editedThread } = await aliceClient.getMessages("room1", { thread_id: msg1.id });
    const bobReply = editedThread.find((m: any) => m.id === threadReply.id);
    expect(bobReply.content.text).toBe("I suggest REST with OpenAPI spec");
    expect(bobReply.edited_at).toBeTruthy();

    // 9. Search
    const { data: searchResults } = await aliceClient.searchMessages("room1", "OpenAPI");
    expect(searchResults.length).toBe(1);

    // 10. Bob sets status
    await bobClient.setStatus("busy", "implementing API");
    const bobInfo = await aliceClient.getParticipant("bob-agent");
    expect(bobInfo.status.state).toBe("busy");

    // 11. Events were generated
    const events = await aliceClient.getEvents("room1", 0);
    const eventTypes = events.data.map((e: any) => e.event_type);
    expect(eventTypes).toContain("message.created");
    expect(eventTypes).toContain("reaction.added");
    expect(eventTypes).toContain("message.pinned");

    // 12. Alice removes reaction
    await bobClient.removeReaction(msg1.id, "👍");
    const { data: noReaction } = await aliceClient.getMessages("room1");
    const original = noReaction.find((m: any) => m.id === msg1.id);
    expect(original.reactions.length).toBe(0);

    // 13. Alice unpins
    await aliceClient.unpinMessage(msg1.id);
    const pinsAfter = await bobClient.getPins("room1");
    expect(pinsAfter.data.length).toBe(0);

    // 14. Bob deletes his reply
    await bobClient.deleteMessage(threadReply.id);
    const { data: afterDelete } = await aliceClient.getMessages("room1", { thread_id: msg1.id });
    expect(afterDelete.length).toBe(1); // Only alice's reply remains
  });

  test("room management: create, invite, topic, members, kick", async () => {
    const aliceClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "alice",
      privateKey: alicePrivKey,
    });
    const bobClient = new ChatApiClient({
      serverUrl: `http://localhost:${port}`,
      participantId: "bob-agent",
      privateKey: bobPrivKey,
    });

    // Alice creates a new room
    const room = await aliceClient.createRoom("design-review");
    expect(room.name).toBe("design-review");

    // Bob can't see it yet
    const { data: bobRooms } = await bobClient.listRooms();
    const found = bobRooms.find((r: any) => r.id === room.id);
    expect(found).toBeUndefined();

    // Alice invites Bob
    await aliceClient.invite(room.id, "bob-agent");

    // Bob can now see and use it
    const { data: bobRooms2 } = await bobClient.listRooms();
    expect(bobRooms2.find((r: any) => r.id === room.id)).toBeTruthy();

    // Alice sets topic
    await aliceClient.setTopic(room.id, "Q2 API design review");
    const roomInfo = await bobClient.getRoom(room.id);
    expect(roomInfo.topic).toBe("Q2 API design review");

    // Check members
    const { data: members } = await aliceClient.getParticipants(room.id);
    expect(members.length).toBe(2);

    // Alice kicks Bob
    await aliceClient.kick(room.id, "bob-agent");
    const { data: bobRooms3 } = await bobClient.listRooms();
    expect(bobRooms3.find((r: any) => r.id === room.id)).toBeUndefined();
  });

  test("auth flow: register, challenge-response login, authenticated operations", async () => {
    // Create a fresh server with auth required
    const authDb = createDatabase(":memory:");
    const { app: authApp } = createApp(authDb, { requireAuth: true, verifySignatures: true });
    const authServer = Bun.serve({ port: 0, fetch: authApp.fetch });

    try {
      const client = new ChatApiClient({
        serverUrl: `http://localhost:${authServer.port}`,
        privateKey: alicePrivKey,
      });

      // Register
      const reg = await client.register("test-agent", "agent", aliceKeys.publicKeyPem);
      expect(reg.id).toBeTruthy();

      // Login (sets token and participantId on client)
      const token = await client.login(reg.id, alicePrivKey);
      expect(token).toBeTruthy();

      // Authenticated operation
      const room = await client.createRoom("auth-test");
      expect(room.name).toBe("auth-test");

      // Send signed message (client has privateKey, so it will sign)
      const msg = await client.sendMessage(room.id, "Authenticated and signed!");
      expect(msg.id).toBeTruthy();
    } finally {
      authServer.stop();
    }
  });
});
