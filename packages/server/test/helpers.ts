import { Hono } from "hono";
import { mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign } from "@chat-mcp/shared";
import { v4 as uuid } from "uuid";

import { initDb } from "../src/db/schema.js";
import { AuthService } from "../src/services/auth.js";
import { MessageService } from "../src/services/messages.js";
import { EventService } from "../src/services/events.js";
import { authRoutes } from "../src/routes/auth.js";
import { roomRoutes } from "../src/routes/rooms.js";
import { messageRoutes } from "../src/routes/messages.js";
import { eventRoutes } from "../src/routes/events.js";
import { attachmentRoutes } from "../src/routes/attachments.js";
import { healthRoutes } from "../src/routes/health.js";
import { bearerAuth } from "../src/middleware/auth.js";
import { protocolVersion } from "../src/middleware/protocol-version.js";

export interface TestUser {
  participantId: string;
  sessionToken: string;
  keyPath: string;
  publicKey: string;
  displayName: string;
}

export interface TestApp {
  app: Hono;
  db: ReturnType<typeof initDb>;
}

/**
 * Generate an SSH keypair in a temp directory. Returns paths.
 */
export function generateTestKeys(tmpDir: string, name: string) {
  const keyPath = join(tmpDir, `${name}_key`);
  execFileSync("ssh-keygen", [
    "-t", "ed25519", "-f", keyPath, "-N", "", "-C", `${name}@chat-mcp`,
  ]);
  const publicKey = readFileSync(keyPath + ".pub", "utf-8").trim();
  return { keyPath, publicKey };
}

/**
 * Create a test Hono app with all routes wired up, backed by an in-memory DB.
 */
export function createTestApp(): TestApp {
  const db = initDb(":memory:");
  const authService = new AuthService(db);
  const messageService = new MessageService(db);
  const eventService = new EventService(db);

  const app = new Hono();
  app.use("*", protocolVersion());
  app.route("/health", healthRoutes());
  app.route("/auth", authRoutes(authService));
  app.use("/rooms/*", bearerAuth(authService));
  app.use("/messages/*", bearerAuth(authService));
  app.use("/attachments/*", bearerAuth(authService));
  app.route("/rooms", roomRoutes(db, messageService, eventService));
  app.route("/rooms", eventRoutes(db, eventService));
  app.route("/messages", messageRoutes(db, messageService, eventService));
  const attachRoutes = attachmentRoutes(db, join(tmpdir(), "chat-mcp-test-attachments-" + uuid().slice(0, 8)));
  app.route("/", attachRoutes);
  app.use("/participants/*", bearerAuth(authService));

  // Participant endpoints
  app.get("/participants/lookup", (c) => {
    const displayName = c.req.query("display_name");
    const query = displayName
      ? `SELECT id, display_name, type, paired_with FROM participants WHERE display_name LIKE ?`
      : `SELECT id, display_name, type, paired_with FROM participants LIMIT 50`;
    const params = displayName ? [`%${displayName}%`] : [];
    const rows = db.prepare(query).all(...params);
    return c.json({ items: rows, cursor: null, has_more: false });
  });

  app.get("/participants/:id", (c) => {
    const id = c.req.param("id");
    const participant = db
      .prepare(`SELECT id, display_name, type, paired_with, created_at FROM participants WHERE id = ?`)
      .get(id);
    if (!participant) {
      return c.json({ error: { code: "not_found", message: "Participant not found" } }, 404);
    }
    const keys = db
      .prepare(`SELECT public_key, fingerprint, valid_from, valid_until FROM key_history WHERE participant_id = ? ORDER BY valid_from DESC`)
      .all(id);
    return c.json({ ...(participant as object), key_history: keys });
  });

  app.post("/participants/me/status", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const body = await c.req.json();
    const { state, description } = body;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE participants SET status_state = ?, status_description = ?, status_updated_at = ? WHERE id = ?`,
    ).run(state, description ?? null, now, participantId);

    // Emit status event to all rooms this participant belongs to
    const rooms = db
      .prepare(`SELECT room_id FROM room_members WHERE participant_id = ?`)
      .all(participantId) as { room_id: string }[];
    for (const { room_id } of rooms) {
      const payload = JSON.stringify({ participant_id: participantId, state, description });
      const result = db
        .prepare(`INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`)
        .run(room_id, "participant.status", payload);
      eventService.notify(room_id, Number(result.lastInsertRowid), "participant.status", payload);
    }

    return c.json({ ok: true });
  });

  return { app, db };
}

/**
 * Register a participant and authenticate, returning a TestUser.
 */
export async function registerAndAuth(
  app: Hono,
  displayName: string,
  keyPath: string,
  publicKey: string,
  type: "human" | "agent" = "human",
  pairedWith?: string,
): Promise<TestUser> {
  // Register
  const regRes = await app.request("http://localhost/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: displayName,
      type,
      public_key: publicKey,
      paired_with: pairedWith,
    }),
  });
  const regBody = await regRes.json();
  const participantId = regBody.participant_id;

  // Challenge
  const chalRes = await app.request("http://localhost/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participantId }),
  });
  const chalBody = await chalRes.json();

  // Sign
  const signedChallenge = await sign(keyPath, { challenge: chalBody.challenge });

  // Verify
  const verRes = await app.request("http://localhost/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant_id: participantId,
      signed_challenge: signedChallenge,
    }),
  });
  const verBody = await verRes.json();

  return {
    participantId,
    sessionToken: verBody.session_token,
    keyPath,
    publicKey,
    displayName,
  };
}

/**
 * Make an authenticated request.
 */
export function authedReq(
  app: Hono,
  token: string,
  path: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return app.request(`http://localhost${path}`, { ...init, headers });
}

/**
 * Send a signed message and return the response.
 */
export async function sendSignedMessage(
  app: Hono,
  user: TestUser,
  roomId: string,
  text: string,
  opts?: { threadId?: string; format?: string },
): Promise<{ res: Response; body: any }> {
  const nonce = uuid();
  const timestamp = new Date().toISOString();
  const content = { format: opts?.format ?? "plain", text };
  const payload = {
    room_id: roomId,
    content,
    thread_id: opts?.threadId ?? null,
    mentions: [],
    attachments: [],
    nonce,
    timestamp,
  };
  const signature = await sign(user.keyPath, payload);

  const res = await authedReq(app, user.sessionToken, `/rooms/${roomId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      thread_id: opts?.threadId,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
      signature,
    }),
  });

  const body = res.status === 201 ? await res.json() : await res.json().catch(() => null);
  return { res, body };
}
