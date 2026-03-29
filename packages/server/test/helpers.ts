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
import { adminRoutes } from "../src/routes/admin.js";
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
  adminUser: TestUser;
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
 * Bootstraps a super admin and returns their credentials.
 */
export async function createTestApp(tmpDir: string): Promise<TestApp> {
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
  app.use("/admin/*", bearerAuth(authService));
  app.use("/participants/*", bearerAuth(authService));
  app.route("/rooms", roomRoutes(db, messageService, eventService, authService));
  app.route("/rooms", eventRoutes(db, eventService));
  app.route("/messages", messageRoutes(db, messageService, eventService));
  app.route("/admin", adminRoutes(db, authService));
  const attachRoutes = attachmentRoutes(db, join(tmpdir(), "chat-mcp-test-attachments-" + uuid().slice(0, 8)));
  app.route("/", attachRoutes);

  // Participant endpoints (inline, same as server index.ts)
  app.get("/participants/lookup", (c) => {
    const displayName = c.req.query("display_name");
    const query = displayName
      ? `SELECT id, display_name, type, role, paired_with FROM participants WHERE display_name LIKE ?`
      : `SELECT id, display_name, type, role, paired_with FROM participants LIMIT 50`;
    const params = displayName ? [`%${displayName}%`] : [];
    const rows = db.prepare(query).all(...params);
    return c.json({ items: rows, cursor: null, has_more: false });
  });

  app.post("/participants/me/status", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const body = await c.req.json();
    const { state, description } = body;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE participants SET status_state = ?, status_description = ?, status_updated_at = ? WHERE id = ?`,
    ).run(state, description ?? null, now, participantId);

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

  app.patch("/participants/me", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const body = await c.req.json();
    const { display_name } = body;
    if (!display_name) return c.json({ error: { code: "invalid_request", message: "Missing display_name" } }, 400);
    try {
      authService.updateDisplayName(participantId, display_name);
      return c.json({ ok: true, display_name });
    } catch (e: any) {
      return c.json({ error: { code: "invalid_request", message: e.message } }, 400);
    }
  });

  app.get("/participants/:id", (c) => {
    const id = c.req.param("id");
    const participant = db
      .prepare(`SELECT id, display_name, type, role, paired_with, created_at FROM participants WHERE id = ?`)
      .get(id);
    if (!participant) {
      return c.json({ error: { code: "not_found", message: "Participant not found" } }, 404);
    }
    const keys = db
      .prepare(`SELECT public_key, fingerprint, valid_from, valid_until FROM key_history WHERE participant_id = ? ORDER BY valid_from DESC`)
      .all(id);
    return c.json({ ...(participant as object), key_history: keys });
  });

  // Bootstrap super admin
  const adminKeys = generateTestKeys(tmpDir, "admin");
  const adminId = await authService.bootstrapSuperAdmin(adminKeys.publicKey);
  const adminToken = await authenticateUser(app, adminId, adminKeys.keyPath);

  return {
    app,
    db,
    adminUser: {
      participantId: adminId,
      sessionToken: adminToken,
      keyPath: adminKeys.keyPath,
      publicKey: adminKeys.publicKey,
      displayName: "admin",
    },
  };
}

/**
 * Authenticate a participant (challenge-response), returning the session token.
 */
async function authenticateUser(app: Hono, participantId: string, keyPath: string): Promise<string> {
  const chalRes = await app.request("http://localhost/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participantId }),
  });
  const chalBody = await chalRes.json();
  const signedChallenge = await sign(keyPath, { challenge: chalBody.challenge });

  const verRes = await app.request("http://localhost/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      participant_id: participantId,
      signed_challenge: signedChallenge,
    }),
  });
  const verBody = await verRes.json();
  return verBody.session_token;
}

/**
 * Register a participant via admin-gated direct registration, then authenticate.
 */
export async function registerAndAuth(
  app: Hono,
  adminToken: string,
  displayName: string,
  keyPath: string,
  publicKey: string,
  type: "human" | "agent" = "human",
  pairedWith?: string,
): Promise<TestUser> {
  const regRes = await app.request("http://localhost/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      display_name: displayName,
      type,
      public_key: publicKey,
      paired_with: pairedWith,
    }),
  });
  const regBody = await regRes.json();
  const participantId = regBody.participant_id;

  const sessionToken = await authenticateUser(app, participantId, keyPath);

  return {
    participantId,
    sessionToken,
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
