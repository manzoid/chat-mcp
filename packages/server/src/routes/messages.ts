import { Hono } from "hono";
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { MessageService } from "../services/messages.js";
import type { EventService } from "../services/events.js";

export function messageRoutes(
  db: Database.Database,
  messageService?: MessageService,
  eventService?: EventService,
) {
  const app = new Hono();

  // Helper: check that the authenticated user is a member of the room containing a message
  function requireRoomMembership(participantId: string, roomId: string) {
    const member = db
      .prepare(`SELECT 1 FROM room_members WHERE room_id = ? AND participant_id = ?`)
      .get(roomId, participantId);
    return !!member;
  }

  // Get a single message
  app.get("/:id", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");
    const msg = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(msgId) as
      | Record<string, unknown>
      | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }

    if (!requireRoomMembership(participantId, msg.room_id as string)) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const mentions = db
      .prepare(`SELECT participant_id FROM mentions WHERE message_id = ?`)
      .all(msgId)
      .map((r: any) => r.participant_id);

    const reactions = db
      .prepare(
        `SELECT emoji, author_id, signature, created_at FROM reactions WHERE message_id = ?`,
      )
      .all(msgId);

    const editHistory = db
      .prepare(
        `SELECT content_format, content_text, nonce, signature, edited_at FROM edit_history WHERE message_id = ? ORDER BY edited_at ASC`,
      )
      .all(msgId);

    // Thread summary
    const threadSummary = db
      .prepare(
        `SELECT COUNT(*) as reply_count, MAX(created_at) as last_activity FROM messages WHERE thread_id = ? AND deleted = 0`,
      )
      .get(msgId) as { reply_count: number; last_activity: string | null };

    const threadParticipants =
      threadSummary.reply_count > 0
        ? db
            .prepare(
              `SELECT DISTINCT author_id FROM messages WHERE thread_id = ? AND deleted = 0`,
            )
            .all(msgId)
            .map((r: any) => r.author_id)
        : [];

    return c.json({
      ...(msg as object),
      mentions,
      reactions,
      edit_history: editHistory,
      thread: {
        reply_count: threadSummary.reply_count,
        last_activity: threadSummary.last_activity,
        participants: threadParticipants,
      },
    });
  });

  // Edit message
  app.patch("/:id", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");

    const msg = db
      .prepare(`SELECT * FROM messages WHERE id = ? AND deleted = 0`)
      .get(msgId) as Record<string, unknown> | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }
    if (msg.author_id !== participantId) {
      return c.json(
        { error: { code: "forbidden", message: "Can only edit own messages" } },
        403,
      );
    }

    const body = await c.req.json();
    const { content, nonce, signature, timestamp } = body;

    if (!content?.text || !nonce || !signature) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing fields" } },
        400,
      );
    }

    // Verify edit signature
    if (messageService) {
      try {
        messageService.checkTimestamp(timestamp ?? new Date().toISOString());
        messageService.checkAndRecordNonce(participantId, nonce);
        await messageService.verifyMessageSignature(
          participantId,
          {
            room_id: msg.room_id as string,
            content: { format: content.format ?? "plain", text: content.text },
            thread_id: null,
            mentions: [],
            attachments: [],
            nonce,
            timestamp: timestamp ?? new Date().toISOString(),
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

    // Save old version to edit_history
    db.prepare(
      `INSERT INTO edit_history (message_id, content_format, content_text, nonce, signature, edited_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      msgId,
      msg.content_format,
      msg.content_text,
      msg.nonce,
      msg.signature,
      new Date().toISOString(),
    );

    // Update message
    const editedAt = new Date().toISOString();
    db.prepare(
      `UPDATE messages SET content_format = ?, content_text = ?, nonce = ?, signature = ?, edited_at = ? WHERE id = ?`,
    ).run(content.format ?? "plain", content.text, nonce, signature, editedAt, msgId);

    // Emit event
    const roomId = msg.room_id as string;
    const eventPayload = JSON.stringify({
      message_id: msgId,
      content: { format: content.format ?? "plain", text: content.text },
      edited_at: editedAt,
    });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(roomId, "message.edited", eventPayload);
    eventService?.notify(
      roomId,
      Number(eventResult.lastInsertRowid),
      "message.edited",
      eventPayload,
    );

    return c.json({ ok: true, edited_at: editedAt });
  });

  // Delete message
  app.delete("/:id", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");

    const msg = db
      .prepare(`SELECT * FROM messages WHERE id = ? AND deleted = 0`)
      .get(msgId) as Record<string, unknown> | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }
    if (msg.author_id !== participantId) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: "Can only delete own messages",
          },
        },
        403,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const { deleted_signature } = body;

    db.prepare(
      `UPDATE messages SET deleted = 1, deleted_signature = ? WHERE id = ?`,
    ).run(deleted_signature ?? null, msgId);

    // Emit event
    const roomId = msg.room_id as string;
    const eventPayload = JSON.stringify({ message_id: msgId });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(roomId, "message.deleted", eventPayload);
    eventService?.notify(
      roomId,
      Number(eventResult.lastInsertRowid),
      "message.deleted",
      eventPayload,
    );

    return c.body(null, 204);
  });

  // Add reaction
  app.post("/:id/reactions", async (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");

    const msg = db
      .prepare(`SELECT room_id FROM messages WHERE id = ?`)
      .get(msgId) as { room_id: string } | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }

    if (!requireRoomMembership(participantId, msg.room_id)) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    const body = await c.req.json();
    const { emoji, signature } = body;

    if (!emoji || !signature) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing emoji or signature" } },
        400,
      );
    }

    db.prepare(
      `INSERT OR REPLACE INTO reactions (message_id, author_id, emoji, signature) VALUES (?, ?, ?, ?)`,
    ).run(msgId, participantId, emoji, signature);

    // Emit event
    const eventPayload = JSON.stringify({
      message_id: msgId,
      reaction: { emoji, author_id: participantId, signature },
    });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(msg.room_id, "reaction.added", eventPayload);
    eventService?.notify(
      msg.room_id,
      Number(eventResult.lastInsertRowid),
      "reaction.added",
      eventPayload,
    );

    return c.json({ ok: true }, 201);
  });

  // Remove reaction
  app.delete("/:id/reactions/:emoji", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");
    const emoji = c.req.param("emoji");

    const msg = db
      .prepare(`SELECT room_id FROM messages WHERE id = ?`)
      .get(msgId) as { room_id: string } | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }

    if (!requireRoomMembership(participantId, msg.room_id)) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    db.prepare(
      `DELETE FROM reactions WHERE message_id = ? AND author_id = ? AND emoji = ?`,
    ).run(msgId, participantId, emoji);

    // Emit event
    const eventPayload = JSON.stringify({
      message_id: msgId,
      emoji,
      author_id: participantId,
    });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(msg.room_id, "reaction.removed", eventPayload);
    eventService?.notify(
      msg.room_id,
      Number(eventResult.lastInsertRowid),
      "reaction.removed",
      eventPayload,
    );

    return c.body(null, 204);
  });

  // Pin message
  app.post("/:id/pin", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");

    const msg = db
      .prepare(`SELECT room_id FROM messages WHERE id = ?`)
      .get(msgId) as { room_id: string } | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }

    if (!requireRoomMembership(participantId, msg.room_id)) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    db.prepare(
      `INSERT OR IGNORE INTO pins (room_id, message_id, pinned_by) VALUES (?, ?, ?)`,
    ).run(msg.room_id, msgId, participantId);

    // Emit event
    const eventPayload = JSON.stringify({
      message_id: msgId,
      by: participantId,
    });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(msg.room_id, "message.pinned", eventPayload);
    eventService?.notify(
      msg.room_id,
      Number(eventResult.lastInsertRowid),
      "message.pinned",
      eventPayload,
    );

    return c.json({ ok: true });
  });

  // Unpin message
  app.delete("/:id/pin", (c) => {
    const participantId = c.get("participantId" as never) as string;
    const msgId = c.req.param("id");

    const msg = db
      .prepare(`SELECT room_id FROM messages WHERE id = ?`)
      .get(msgId) as { room_id: string } | undefined;
    if (!msg) {
      return c.json(
        { error: { code: "not_found", message: "Message not found" } },
        404,
      );
    }

    if (!requireRoomMembership(participantId, msg.room_id)) {
      return c.json(
        { error: { code: "forbidden", message: "Not a member of this room" } },
        403,
      );
    }

    db.prepare(`DELETE FROM pins WHERE room_id = ? AND message_id = ?`).run(
      msg.room_id,
      msgId,
    );

    // Emit event
    const eventPayload = JSON.stringify({
      message_id: msgId,
      by: participantId,
    });
    const eventResult = db
      .prepare(
        `INSERT INTO events (room_id, event_type, payload_json) VALUES (?, ?, ?)`,
      )
      .run(msg.room_id, "message.unpinned", eventPayload);
    eventService?.notify(
      msg.room_id,
      Number(eventResult.lastInsertRowid),
      "message.unpinned",
      eventPayload,
    );

    return c.body(null, 204);
  });

  return app;
}
