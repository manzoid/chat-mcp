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
import { healthRoutes } from "./routes/health.js";
import { bearerAuth } from "./middleware/auth.js";
import { protocolVersion } from "./middleware/protocol-version.js";

const PORT = parseInt(process.env.PORT ?? "8808");
const DB_PATH = process.env.DB_PATH ?? "chat.db";
const ATTACHMENT_PATH = process.env.ATTACHMENT_PATH ?? "./attachments";

const db = initDb(DB_PATH);
const authService = new AuthService(db);
const messageService = new MessageService(db);
const eventService = new EventService(db);

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
app.route("/rooms", roomRoutes(db, messageService, eventService));
app.route("/rooms", eventRoutes(db, eventService));
app.route("/messages", messageRoutes(db, messageService, eventService));
app.use("/attachments/*", bearerAuth(authService));
const attachRoutes = attachmentRoutes(db, ATTACHMENT_PATH);
app.route("/", attachRoutes);

// Participant lookup
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
