import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { initDb } from "./db/schema.js";
import { AuthService } from "./services/auth.js";
import { MessageService } from "./services/messages.js";
import { EventService } from "./services/events.js";
import { authRoutes } from "./routes/auth.js";
import { roomRoutes } from "./routes/rooms.js";
import { messageRoutes } from "./routes/messages.js";
import { eventRoutes } from "./routes/events.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { adminRoutes } from "./routes/admin.js";
import { healthRoutes } from "./routes/health.js";
import { bearerAuth } from "./middleware/auth.js";
import { protocolVersion } from "./middleware/protocol-version.js";

const PORT = parseInt(process.env.PORT ?? "8808");
const DB_PATH = process.env.DB_PATH ?? "chat.db";
const ATTACHMENT_PATH = process.env.ATTACHMENT_PATH ?? "./attachments";
const SUPER_ADMIN_KEY = process.env.SUPER_ADMIN_KEY;

const db = initDb(DB_PATH);
const authService = new AuthService(db);
const messageService = new MessageService(db);
const eventService = new EventService(db);

// Bootstrap super admin from env var
if (SUPER_ADMIN_KEY) {
  authService.bootstrapSuperAdmin(SUPER_ADMIN_KEY).then((id) => {
    console.log(`Super admin: ${id}`);
  });
}

const app = new Hono();

// Global middleware
app.use("*", protocolVersion());

// Public routes (no auth required)
app.route("/health", healthRoutes());
app.route("/auth", authRoutes(authService));

// Protected routes
app.use("/rooms/*", bearerAuth(authService));
app.use("/messages/*", bearerAuth(authService));
app.use("/participants/*", bearerAuth(authService));
app.use("/admin/*", bearerAuth(authService));
app.route("/rooms", roomRoutes(db, messageService, eventService, authService));
app.route("/rooms", eventRoutes(db, eventService));
app.route("/messages", messageRoutes(db, messageService, eventService));
app.route("/admin", adminRoutes(db, authService));
app.use("/attachments/*", bearerAuth(authService));
const attachRoutes = attachmentRoutes(db, ATTACHMENT_PATH);
app.route("/", attachRoutes);

// Participant endpoints
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

// Change own display name
app.patch("/participants/me", async (c) => {
  const participantId = c.get("participantId" as never) as string;
  const body = await c.req.json();
  const { display_name } = body;

  if (!display_name) {
    return c.json(
      { error: { code: "invalid_request", message: "Missing display_name" } },
      400,
    );
  }

  try {
    authService.updateDisplayName(participantId, display_name);
    return c.json({ ok: true, display_name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return c.json({ error: { code: "invalid_request", message: msg } }, 400);
  }
});

app.get("/participants/:id", (c) => {
  const id = c.req.param("id");
  const participant = db
    .prepare(`SELECT id, display_name, type, role, paired_with, created_at FROM participants WHERE id = ?`)
    .get(id);
  if (!participant) {
    return c.json(
      { error: { code: "not_found", message: "Participant not found" } },
      404,
    );
  }
  const keys = db
    .prepare(`SELECT public_key, fingerprint, valid_from, valid_until FROM key_history WHERE participant_id = ? ORDER BY valid_from DESC`)
    .all(id);
  return c.json({ ...(participant as object), key_history: keys });
});

console.log(`Chat MCP server starting on port ${PORT}`);
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Chat MCP server running at http://localhost:${info.port}`);
});

export { app, db, authService, messageService };
