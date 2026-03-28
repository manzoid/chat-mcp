import { describe, test, expect, beforeEach } from "bun:test";
import { createDatabase } from "../src/db/connection";
import { createApp } from "../src/app";
import { Database } from "bun:sqlite";
import {
  generateKeyPair,
  loadPrivateKey,
  signData,
  signPayload,
  canonicalJsonHash,
  generateNonce,
} from "@chat-mcp/shared";

let db: Database;
let app: ReturnType<typeof createApp>["app"];

// Generate test keypairs
const alice = generateKeyPair();
const alicePrivKey = loadPrivateKey(alice.privateKeyPem);

function req(method: string, path: string, body?: any, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

async function registerAndLogin(): Promise<{ participantId: string; token: string }> {
  // Register
  const regRes = await req("POST", "/auth/register", {
    display_name: "alice",
    type: "human",
    public_key_pem: alice.publicKeyPem,
  });
  const participant = await regRes.json();

  // Challenge
  const chalRes = await req("POST", "/auth/challenge", {
    participant_id: participant.id,
  });
  const { challenge } = await chalRes.json();

  // Sign the challenge
  const signed = signData(alicePrivKey, Buffer.from(challenge));

  // Verify
  const verRes = await req("POST", "/auth/verify", {
    participant_id: participant.id,
    signed_challenge: signed,
  });
  const { session_token } = await verRes.json();

  return { participantId: participant.id, token: session_token };
}

describe("auth flow (with requireAuth)", () => {
  beforeEach(() => {
    db = createDatabase(":memory:");
    const result = createApp(db, { requireAuth: true });
    app = result.app;
  });

  test("health works without auth", async () => {
    const res = await req("GET", "/health");
    expect(res.status).toBe(200);
  });

  test("protected endpoint returns 401 without token", async () => {
    const res = await req("GET", "/rooms");
    expect(res.status).toBe(401);
  });

  test("full challenge-response login flow", async () => {
    const { token } = await registerAndLogin();
    expect(token).toBeTruthy();

    // Use token to access protected endpoint
    const res = await req("GET", "/rooms", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  test("wrong signature fails auth", async () => {
    const regRes = await req("POST", "/auth/register", {
      display_name: "bob",
      type: "human",
      public_key_pem: alice.publicKeyPem,
    });
    const participant = await regRes.json();

    const chalRes = await req("POST", "/auth/challenge", {
      participant_id: participant.id,
    });
    const { challenge } = await chalRes.json();

    // Sign with wrong data
    const wrongSig = signData(alicePrivKey, Buffer.from("wrong data"));

    const verRes = await req("POST", "/auth/verify", {
      participant_id: participant.id,
      signed_challenge: wrongSig,
    });
    expect(verRes.status).toBe(401);
  });

  test("expired token returns 401", async () => {
    const { participantId, token } = await registerAndLogin();

    // Manually expire the token
    db.run("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'");

    const res = await req("GET", "/rooms", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(401);
  });

  test("revoke invalidates all sessions", async () => {
    const { participantId, token } = await registerAndLogin();

    // Revoke
    await req("POST", "/auth/revoke", undefined, {
      Authorization: `Bearer ${token}`,
    });

    // Token should no longer work
    const res = await req("GET", "/rooms", undefined, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(401);
  });
});

describe("message signature verification", () => {
  let participantId: string;

  beforeEach(() => {
    db = createDatabase(":memory:");
    const result = createApp(db, { verifySignatures: true });
    app = result.app;

    // Register alice directly
    db.run(
      "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
      ["p-alice", "alice", "human", alice.publicKeyPem]
    );
    db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["p-alice"]);
    participantId = "p-alice";

    // Create a room
    db.run("INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)", ["room1", "test", participantId]);
    db.run("INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)", ["room1", participantId, participantId]);
  });

  test("properly signed message is accepted", async () => {
    const nonce = generateNonce();
    const timestamp = new Date().toISOString();
    const content = { format: "markdown", text: "Hello signed!" };
    const signedPayload = {
      room_id: "room1",
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      timestamp,
      nonce,
    };
    const signature = signPayload(alicePrivKey, signedPayload);

    const res = await req("POST", "/rooms/room1/messages", {
      content,
      signature,
      nonce,
      timestamp,
    }, { "X-Participant-Id": participantId });

    expect(res.status).toBe(201);
  });

  test("tampered message is rejected", async () => {
    const nonce = generateNonce();
    const timestamp = new Date().toISOString();
    const content = { format: "markdown", text: "Hello signed!" };
    const signedPayload = {
      room_id: "room1",
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      timestamp,
      nonce,
    };
    const signature = signPayload(alicePrivKey, signedPayload);

    // Send with different content than what was signed
    const res = await req("POST", "/rooms/room1/messages", {
      content: { format: "markdown", text: "TAMPERED!" },
      signature,
      nonce,
      timestamp,
    }, { "X-Participant-Id": participantId });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_signature");
  });

  test("signature from wrong key is rejected", async () => {
    const otherKeys = generateKeyPair();
    const otherPrivKey = loadPrivateKey(otherKeys.privateKeyPem);

    const nonce = generateNonce();
    const timestamp = new Date().toISOString();
    const content = { format: "markdown", text: "Hello" };
    const signedPayload = {
      room_id: "room1",
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      timestamp,
      nonce,
    };
    const signature = signPayload(otherPrivKey, signedPayload);

    const res = await req("POST", "/rooms/room1/messages", {
      content,
      signature,
      nonce,
      timestamp,
    }, { "X-Participant-Id": participantId });

    expect(res.status).toBe(400);
  });
});
