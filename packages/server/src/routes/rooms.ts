import { Hono } from "hono";
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@chat-mcp/shared";
import type { MessageService } from "../services/messages.js";
import type { EventService } from "../services/events.js";

export function roomRoutes(db: Database.Database, messageService?: MessageService, eventService?: EventService) {
  const app = new Hono();

  // Create room
  app.post("/", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const body = await c.req.json();
    const { name, participants } = body;

    if (!name) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing room name" } },
        400,
      );
    }

    const id = uuid();
    db.prepare(`INSERT INTO rooms (id, name, created_by) VALUES (?, ?, ?)`).run(
      id,
      name,
      participantId,
    );

    // Creator is automatically a member
    db.prepare(
      `INSERT INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)`,
    ).run(id, participantId, participantId);

    // Invite additional participants
    if (Array.isArray(participants)) {
      for (const pid of participants) {
        db.prepare(
          `INSERT OR IGNORE INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)`,
        ).run(id, pid, participantId);
      }
    }

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
    return c.json(room, 201);
  });

  // List rooms (only rooms the participant belongs to)
  app.get("/", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const rooms = db
      .prepare(
        `SELECT r.* FROM rooms r
         JOIN room_members rm ON r.id = rm.room_id
         WHERE rm.participant_id = ?
         ORDER BY r.created_at DESC`,
      )
      .all(participantId);
    return c.json({ items: rooms, cursor: null, has_more: false });
  });

  // Get room details
  app.get("/:id", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    // Check membership
    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    if (!room) {
      return c.json(
        { error: { code: "not_found", message: "Room not found" } },
        404,
      );
    }

    const members = db
      .prepare(
        `SELECT p.id, p.display_name, p.type, p.paired_with
         FROM participants p
         JOIN room_members rm ON p.id = rm.participant_id
         WHERE rm.room_id = ?`,
      )
      .all(roomId);

    const pins = db
      .prepare(`SELECT message_id FROM pins WHERE room_id = ?`)
      .all(roomId)
      .map((r: any) => r.message_id);

    return c.json({ ...(room as object), participants: members, pinned: pins });
  });

  // Post message
  app.post("/:id/messages", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    // Check membership
    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const body = await c.req.json();
    const { content, thread_id, nonce, signature } = body;

    if (!content?.text || !nonce || !signature) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Missing content, nonce, or signature",
          },
        },
        400,
      );
    }

    const format = content.format || "plain";
    const timestamp = body.timestamp ?? new Date().toISOString();

    // Verify signature and replay defense if service is available
    if (messageService) {
      try {
        messageService.checkTimestamp(timestamp);
        messageService.checkAndRecordNonce(participantId, nonce);
        await messageService.verifyMessageSignature(
          participantId,
          {
            room_id: roomId,
            content: { format, text: content.text },
            thread_id: thread_id ?? null,
            mentions: body.mentions ?? [],
            attachments: body.attachments ?? [],
            nonce,
            timestamp,
          },
          signature,
        );
      } catch (e: any) {
        if (e.code && e.status) {
          return c.json(e.toJSON(), e.status);
        }
        throw e;
      }
    }

    const id = uuid();

    db.prepare(
      `INSERT INTO messages (id, room_id, author_id, content_format, content_text, thread_id, nonce, sender_timestamp, signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, roomId, participantId, format, content.text, thread_id ?? null, nonce, timestamp, signature);

    // Resolve mentions
    const mentionPattern = /@(\S+)/g;
    let match;
    while ((match = mentionPattern.exec(content.text)) !== null) {
      const name = match[1];
      const mentioned = db
        .prepare(
          `SELECT p.id FROM participants p
           JOIN room_members rm ON p.id = rm.participant_id
           WHERE rm.room_id = ? AND p.display_name = ?`,
        )
        .get(roomId, name) as { id: string } | undefined;
      if (mentioned) {
        db.prepare(
          `INSERT OR IGNORE INTO mentions (message_id, participant_id) VALUES (?, ?)`,
        ).run(id, mentioned.id);
      }
    }

    // Emit event
    const eventPayload = JSON.stringify({
      id,
      room_id: roomId,
      author_id: participantId,
      content: { format, text: content.text },
      thread_id: thread_id ?? null,
      nonce,
      signature,
      created_at: new Date().toISOString(),
    });
    const eventResult = db.prepare(
      `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
    ).run(roomId, "message.created", eventPayload);

    // Notify SSE subscribers
    if (eventService) {
      eventService.notify(roomId, Number(eventResult.lastInsertRowid), "message.created", eventPayload);
    }

    const message = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
    const mentions = db
      .prepare(`SELECT participant_id FROM mentions WHERE message_id = ?`)
      .all(id)
      .map((r: any) => r.participant_id);

    return c.json({ ...(message as object), mentions }, 201);
  });

  // Get messages with cursor-based pagination
  app.get("/:id/messages", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    // Check membership
    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const limit = Math.min(
      parseInt(c.req.query("limit") ?? String(DEFAULT_PAGE_SIZE)),
      MAX_PAGE_SIZE,
    );
    const cursor = c.req.query("cursor");
    const threadId = c.req.query("thread_id");

    let query = `SELECT * FROM messages WHERE room_id = ? AND deleted = 0`;
    const params: unknown[] = [roomId];

    if (threadId) {
      query += ` AND thread_id = ?`;
      params.push(threadId);
    }

    if (cursor) {
      query += ` AND created_at < ?`;
      params.push(cursor);
    }

    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit + 1); // Fetch one extra to determine has_more

    const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor =
      hasMore && items.length > 0
        ? (items[items.length - 1].created_at as string)
        : null;

    return c.json({ items, cursor: nextCursor, has_more: hasMore });
  });

  // Invite participant
  app.post("/:id/invite", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const body = await c.req.json();
    const { participant_id } = body;

    if (!participant_id) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing participant_id" } },
        400,
      );
    }

    db.prepare(
      `INSERT OR IGNORE INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)`,
    ).run(roomId, participant_id, participantId);

    // Emit event
    const invited = db
      .prepare(`SELECT id, display_name, type, paired_with FROM participants WHERE id = ?`)
      .get(participant_id);

    if (invited) {
      db.prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      ).run(roomId, "participant.joined", JSON.stringify(invited));
    }

    return c.json({ ok: true });
  });

  // Get participants
  app.get("/:id/participants", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const members = db
      .prepare(
        `SELECT p.id, p.display_name, p.type, p.paired_with
         FROM participants p
         JOIN room_members rm ON p.id = rm.participant_id
         WHERE rm.room_id = ?`,
      )
      .all(roomId);

    return c.json({ items: members, cursor: null, has_more: false });
  });

  // Set topic
  app.patch("/:id", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const body = await c.req.json();
    if (body.topic !== undefined) {
      db.prepare(`UPDATE rooms SET topic = ? WHERE id = ?`).run(
        body.topic,
        roomId,
      );

      const eventPayload = JSON.stringify({ topic: body.topic });
      const eventResult = db
        .prepare(
          `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
        )
        .run(roomId, "room.topic", eventPayload);
      eventService?.notify(
        roomId,
        Number(eventResult.lastInsertRowid),
        "room.topic",
        eventPayload,
      );
    }

    const room = db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(roomId);
    return c.json(room);
  });

  // Get pins for a room
  app.get("/:id/pins", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const pins = db
      .prepare(
        `SELECT m.*, p.pinned_by, p.created_at as pinned_at
         FROM pins p
         JOIN messages m ON p.message_id = m.id
         WHERE p.room_id = ?
         ORDER BY p.created_at DESC`,
      )
      .all(roomId);

    return c.json({ items: pins, cursor: null, has_more: false });
  });

  // Kick participant
  app.post("/:id/kick", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const room = db
      .prepare(`SELECT created_by FROM rooms WHERE id = ?`)
      .get(roomId) as { created_by: string } | undefined;

    if (!room || room.created_by !== participantId) {
      return c.json(
        { error: { code: "forbidden", message: "Only room creator can kick" } },
        403,
      );
    }

    const body = await c.req.json();
    const { participant_id } = body;

    db.prepare(
      `DELETE FROM room_members WHERE room_id = ? AND participant_id = ?`,
    ).run(roomId, participant_id);

    const eventPayload = JSON.stringify({ participant_id });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(roomId, "participant.left", eventPayload);
    eventService?.notify(
      roomId,
      Number(eventResult.lastInsertRowid),
      "participant.left",
      eventPayload,
    );

    return c.json({ ok: true });
  });

  // Leave room
  app.post("/:id/leave", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    db.prepare(
      `DELETE FROM room_members WHERE room_id = ? AND participant_id = ?`,
    ).run(roomId, participantId);

    return c.json({ ok: true });
  });

  // Search messages
  app.get("/:id/messages/search", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const roomId = c.req.param("id");

    const member = db
      .prepare(
        `SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`,
      )
      .get(roomId, participantId);

    if (!member) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const q = c.req.query("q");
    if (!q) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing search query" } },
        400,
      );
    }

    // FTS5 full-text search — quote the query to handle special characters
    const ftsQuery = `"${q.replace(/"/g, '""')}"`;
    let query = `SELECT m.* FROM messages m
      JOIN messages_fts fts ON m.rowid = fts.rowid
      WHERE fts.messages_fts MATCH ? AND m.room_id = ? AND m.deleted = 0`;
    const params: unknown[] = [ftsQuery, roomId];

    const author = c.req.query("author");
    if (author) {
      query += ` AND m.author_id = ?`;
      params.push(author);
    }

    const hasAttachment = c.req.query("has_attachment");
    if (hasAttachment === "true") {
      query += ` AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)`;
    }

    query += ` ORDER BY m.created_at DESC LIMIT 50`;

    const rows = db.prepare(query).all(...params);
    return c.json({ items: rows, cursor: null, has_more: false });
  });

  return app;
}
