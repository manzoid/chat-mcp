import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type Database from "better-sqlite3";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@chat-mcp/shared";
import type { EventService } from "../services/events.js";

export function eventRoutes(db: Database.Database, eventService: EventService) {
  const app = new Hono();

  // Poll for events (JSON)
  app.get("/:id/events", (c) => {
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

    const sinceSeq = parseInt(c.req.query("since_seq") ?? "0");
    const result = eventService.getEventsSince(roomId, sinceSeq);
    return c.json(result);
  });

  // SSE stream
  app.get("/:id/events/stream", (c) => {
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

    return streamSSE(c, async (stream) => {
      // Catch up from Last-Event-ID if provided
      const lastEventId = c.req.header("Last-Event-ID");
      if (lastEventId) {
        const sinceSeq = parseInt(lastEventId);
        const catchUp = eventService.getEventsSince(roomId, sinceSeq);
        for (const event of catchUp.items) {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: JSON.stringify(event.payload),
          });
        }
      }

      // Subscribe to new events
      const unsubscribe = eventService.subscribe(roomId, async (event) => {
        try {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: event.payload,
          });
        } catch {
          // Client disconnected
          unsubscribe();
        }
      });

      // Heartbeat
      const heartbeat = setInterval(async () => {
        try {
          await stream.writeSSE({ event: "heartbeat", data: "" });
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);

      // Clean up on abort
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Keep the stream alive — wait until aborted
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  return app;
}
