import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { canonicalJsonHash } from "@chat-mcp/shared";
import {
  ParticipantRepo,
  RoomRepo,
  MessageRepo,
  ReactionRepo,
  AttachmentRepo,
  PinRepo,
  EventRepo,
} from "./db/repos.js";
import { createAuthRoutes, authMiddleware, verifyMessageSignature } from "./auth.js";
import { RateLimiter, rateLimitMiddleware } from "./rate-limit.js";

export type AppEnv = {
  Variables: {
    participantId: string;
    db: Database;
    repos: Repos;
  };
};

export interface Repos {
  participants: ParticipantRepo;
  rooms: RoomRepo;
  messages: MessageRepo;
  reactions: ReactionRepo;
  attachments: AttachmentRepo;
  pins: PinRepo;
  events: EventRepo;
}

export interface AppOptions {
  /** If true, require Bearer token auth. If false, use X-Participant-Id header. */
  requireAuth?: boolean;
  /** If true, verify message/reaction signatures on ingestion. */
  verifySignatures?: boolean;
  /** If true, enforce nonce uniqueness to prevent replay attacks. */
  enforceNonces?: boolean;
  /** Rate limit config. If omitted, no rate limiting. */
  rateLimit?: { maxRequests?: number; windowMs?: number };
}

export function createApp(db: Database, options: AppOptions = {}) {
  const repos: Repos = {
    participants: new ParticipantRepo(db),
    rooms: new RoomRepo(db),
    messages: new MessageRepo(db),
    reactions: new ReactionRepo(db),
    attachments: new AttachmentRepo(db),
    pins: new PinRepo(db),
    events: new EventRepo(db),
  };

  const app = new Hono<AppEnv>();

  // Inject repos and db into context
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("repos", repos);
    await next();
  });

  if (options.requireAuth) {
    // Real auth: Bearer token. Only skip health and the auth challenge/verify/register endpoints.
    app.use("*", authMiddleware(["/health", "/auth/register", "/auth/challenge", "/auth/verify"]));
  } else {
    // Dev mode: use X-Participant-Id header
    app.use("*", async (c, next) => {
      const pid = c.req.header("X-Participant-Id") ?? "";
      c.set("participantId", pid);
      await next();
    });
  }

  // Rate limiting (if configured)
  let rateLimiter: RateLimiter | undefined;
  if (options.rateLimit) {
    rateLimiter = new RateLimiter(options.rateLimit);
    app.use("*", rateLimitMiddleware(rateLimiter, ["/health"]));
  }

  // --- Auth routes ---
  app.route("/auth", createAuthRoutes());

  // --- Health ---
  app.get("/health", (c) => {
    return c.json({ status: "ok", version: "0.1.0" });
  });

  // --- Participants ---
  app.post("/auth/register", async (c) => {
    const body = await c.req.json();
    const { display_name, type, public_key_pem, paired_with, github_username } = body;
    if (!display_name || !type || !public_key_pem) {
      return c.json({ error: { code: "invalid_request", message: "Missing required fields" } }, 400);
    }
    try {
      const p = c.get("repos").participants.create({
        display_name,
        type,
        public_key_pem,
        paired_with,
        github_username,
      });
      return c.json(p, 201);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        return c.json({ error: { code: "conflict", message: "Display name already taken" } }, 409);
      }
      throw e;
    }
  });

  app.get("/participants/:id", (c) => {
    const p = c.get("repos").participants.getById(c.req.param("id"));
    if (!p) return c.json({ error: { code: "not_found", message: "Participant not found" } }, 404);
    const presence = c.get("repos").participants.getPresence(p.id);
    return c.json({ ...p, status: presence });
  });

  app.post("/participants/me/status", async (c) => {
    const pid = c.get("participantId");
    const { state, description } = await c.req.json();
    c.get("repos").participants.updatePresence(pid, state, description ?? null);
    return c.json({ ok: true });
  });

  // --- Rooms ---
  app.post("/rooms", async (c) => {
    const pid = c.get("participantId");
    const { name, participants: inviteIds } = await c.req.json();
    if (!name) return c.json({ error: { code: "invalid_request", message: "Name required" } }, 400);
    const room = c.get("repos").rooms.create(name, pid);
    // Invite additional participants
    if (inviteIds?.length) {
      for (const invId of inviteIds) {
        c.get("repos").rooms.addMember(room.id, invId, pid);
      }
    }
    c.get("repos").events.create(room.id, "room.created", { room_id: room.id, created_by: pid });
    return c.json(room, 201);
  });

  app.get("/rooms", (c) => {
    const pid = c.get("participantId");
    const rooms = c.get("repos").rooms.listForParticipant(pid);
    return c.json({ data: rooms });
  });

  app.get("/rooms/:id", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    const room = c.get("repos").rooms.getById(roomId);
    if (!room) return c.json({ error: { code: "not_found", message: "Room not found" } }, 404);
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const members = c.get("repos").rooms.getMembers(roomId);
    const pinned = c.get("repos").pins.getForRoom(roomId);
    return c.json({ ...room, participants: members.map((m) => m.id), pinned });
  });

  app.post("/rooms/:id/invite", async (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const { participant_id } = await c.req.json();
    c.get("repos").rooms.addMember(roomId, participant_id, pid);
    c.get("repos").events.create(roomId, "participant.joined", { participant_id });
    return c.json({ ok: true });
  });

  app.post("/rooms/:id/kick", async (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    const { participant_id } = await c.req.json();
    c.get("repos").rooms.removeMember(roomId, participant_id);
    c.get("repos").events.create(roomId, "participant.left", { participant_id });
    return c.json({ ok: true });
  });

  app.put("/rooms/:id/topic", async (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const { topic } = await c.req.json();
    c.get("repos").rooms.setTopic(roomId, topic);
    c.get("repos").events.create(roomId, "room.topic", { topic });
    return c.json({ ok: true });
  });

  app.get("/rooms/:id/participants", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const members = c.get("repos").rooms.getMembers(roomId);
    const withPresence = members.map((m) => ({
      ...m,
      status: c.get("repos").participants.getPresence(m.id),
    }));
    return c.json({ data: withPresence });
  });

  // --- Messages ---
  app.post("/rooms/:id/messages", async (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const body = await c.req.json();
    const { content, thread_id, signature, nonce, mentions } = body;
    if (!content?.text || !signature || !nonce) {
      return c.json({ error: { code: "invalid_request", message: "Missing required fields" } }, 400);
    }
    // Nonce uniqueness check (replay prevention)
    if (options.enforceNonces) {
      const existing = db.query("SELECT nonce FROM nonces WHERE nonce = ?").get(nonce);
      if (existing) {
        return c.json({ error: { code: "duplicate_nonce", message: "Nonce already used (possible replay)" } }, 400);
      }
      const nonceExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
      db.run("INSERT INTO nonces (nonce, participant_id, expires_at) VALUES (?, ?, ?)", [nonce, pid, nonceExpiry]);
    }
    // Signature verification (if enabled)
    if (options.verifySignatures) {
      const signedPayload = {
        room_id: roomId,
        content: { format: content.format || "markdown", text: content.text },
        thread_id: thread_id ?? null,
        mentions: mentions ?? [],
        attachments: body.attachments ?? [],
        timestamp: body.timestamp,
        nonce,
      };
      const payloadHash = canonicalJsonHash(signedPayload);
      if (!verifyMessageSignature(db, pid, signature, payloadHash)) {
        return c.json({ error: { code: "invalid_signature", message: "Message signature verification failed" } }, 400);
      }
    }
    const msg = c.get("repos").messages.create({
      room_id: roomId,
      author_id: pid,
      content_format: content.format || "markdown",
      content_text: content.text,
      thread_id,
      signature,
      nonce,
      timestamp: body.timestamp,
      mentions,
    });
    c.get("repos").events.create(roomId, "message.created", {
      id: msg.id,
      author_id: pid,
      content,
      thread_id,
      signature: msg.signature,
      nonce: msg.nonce,
      timestamp: msg.timestamp,
      room_id: roomId,
    });
    return c.json(msg, 201);
  });

  app.get("/rooms/:id/messages", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const limit = parseInt(c.req.query("limit") || "50");
    const before = c.req.query("before");
    const threadId = c.req.query("thread_id");

    let messages;
    if (threadId) {
      messages = c.get("repos").messages.getThread(threadId);
    } else {
      messages = c.get("repos").messages.listForRoom(roomId, limit, before || undefined);
    }

    // Enrich with reactions and mentions
    const enriched = messages.map((m) => ({
      ...m,
      content: { format: m.content_format, text: m.content_text },
      reactions: c.get("repos").reactions.getForMessage(m.id),
      mentions: c.get("repos").messages.getMentions(m.id),
      attachments: c.get("repos").attachments.getForMessage(m.id),
    }));

    return c.json({ data: enriched });
  });

  app.get("/rooms/:id/messages/search", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const q = c.req.query("q");
    if (!q) return c.json({ error: { code: "invalid_request", message: "Query required" } }, 400);
    const results = c.get("repos").messages.search(roomId, q);
    return c.json({ data: results });
  });

  app.patch("/messages/:id", async (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const msg = c.get("repos").messages.getById(msgId);
    if (!msg) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
    if (msg.author_id !== pid) return c.json({ error: { code: "forbidden", message: "Not your message" } }, 403);
    const { content, signature } = await c.req.json();
    c.get("repos").messages.edit(msgId, content.format || "markdown", content.text, signature);
    c.get("repos").events.create(msg.room_id, "message.edited", { message_id: msgId, content });
    return c.json({ ok: true });
  });

  app.delete("/messages/:id", (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const msg = c.get("repos").messages.getById(msgId);
    if (!msg) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
    if (msg.author_id !== pid) return c.json({ error: { code: "forbidden", message: "Not your message" } }, 403);
    c.get("repos").messages.softDelete(msgId);
    c.get("repos").events.create(msg.room_id, "message.deleted", { message_id: msgId });
    return c.json({ ok: true });
  });

  // --- Reactions ---
  app.post("/messages/:id/reactions", async (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const { emoji, signature } = await c.req.json();
    c.get("repos").reactions.add(msgId, pid, emoji, signature);
    const msg = c.get("repos").messages.getById(msgId);
    if (msg) {
      c.get("repos").events.create(msg.room_id, "reaction.added", {
        message_id: msgId,
        emoji,
        author_id: pid,
      });
    }
    return c.json({ ok: true });
  });

  app.delete("/messages/:id/reactions/:emoji", (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const emoji = c.req.param("emoji");
    c.get("repos").reactions.remove(msgId, pid, emoji);
    return c.json({ ok: true });
  });

  // --- Pins ---
  app.post("/messages/:id/pin", (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const msg = c.get("repos").messages.getById(msgId);
    if (!msg) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
    c.get("repos").pins.pin(msg.room_id, msgId, pid);
    c.get("repos").events.create(msg.room_id, "message.pinned", { message_id: msgId, by: pid });
    return c.json({ ok: true });
  });

  app.delete("/messages/:id/pin", (c) => {
    const pid = c.get("participantId");
    const msgId = c.req.param("id");
    const msg = c.get("repos").messages.getById(msgId);
    if (!msg) return c.json({ error: { code: "not_found", message: "Message not found" } }, 404);
    c.get("repos").pins.unpin(msg.room_id, msgId);
    c.get("repos").events.create(msg.room_id, "message.unpinned", { message_id: msgId, by: pid });
    return c.json({ ok: true });
  });

  app.get("/rooms/:id/pins", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const pinnedIds = c.get("repos").pins.getForRoom(roomId);
    return c.json({ data: pinnedIds });
  });

  // --- Events (polling) ---
  app.get("/rooms/:id/events", (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }
    const sinceSeq = parseInt(c.req.query("since_seq") || "0");
    const events = c.get("repos").events.getSince(roomId, sinceSeq);
    return c.json({ data: events });
  });

  // --- SSE stream ---
  // In-memory pub/sub for SSE clients
  const sseClients = new Map<string, Set<(event: any) => void>>();

  function notifyRoom(roomId: string, event: any) {
    const clients = sseClients.get(roomId);
    if (clients) {
      for (const cb of clients) {
        try { cb(event); } catch {}
      }
    }
  }

  // Patch event creation to also notify SSE clients
  const originalCreateEvent = repos.events.create.bind(repos.events);
  repos.events.create = (roomId: string, eventType: string, payload: any) => {
    const event = originalCreateEvent(roomId, eventType, payload);
    notifyRoom(roomId, event);
    return event;
  };

  app.get("/rooms/:id/stream", async (c) => {
    const pid = c.get("participantId");
    const roomId = c.req.param("id");
    if (!c.get("repos").rooms.isMember(roomId, pid)) {
      return c.json({ error: { code: "forbidden", message: "Not a member" } }, 403);
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (data: string) => {
          controller.enqueue(encoder.encode(data));
        };

        // Send keepalive comment
        send(":ok\n\n");

        const callback = (event: any) => {
          send(`data: ${JSON.stringify(event)}\n\n`);
        };

        if (!sseClients.has(roomId)) {
          sseClients.set(roomId, new Set());
        }
        sseClients.get(roomId)!.add(callback);

        // Cleanup on close
        c.req.raw.signal.addEventListener("abort", () => {
          sseClients.get(roomId)?.delete(callback);
          if (sseClients.get(roomId)?.size === 0) {
            sseClients.delete(roomId);
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return { app, repos, rateLimiter };
}
