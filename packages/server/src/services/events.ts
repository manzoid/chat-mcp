import type Database from "better-sqlite3";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@chat-mcp/shared";

type EventCallback = (event: { seq: number; type: string; payload: string }) => void;

/**
 * Manages event subscriptions for SSE clients.
 * Rooms have per-room subscriber lists. When a new event is inserted,
 * all subscribers for that room are notified.
 */
export class EventService {
  private subscribers = new Map<string, Set<EventCallback>>();

  constructor(private db: Database.Database) {}

  /**
   * Get events since a given sequence number for catch-up.
   */
  getEventsSince(roomId: string, sinceSeq: number, limit = 100) {
    const rows = this.db
      .prepare(
        `SELECT seq, event_type, payload_json, created_at
         FROM events
         WHERE room_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(roomId, sinceSeq, limit + 1) as {
      seq: number;
      event_type: string;
      payload_json: string;
      created_at: string;
    }[];

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextSeq = items.length > 0 ? items[items.length - 1].seq : sinceSeq;

    return {
      items: items.map((r) => ({
        seq: r.seq,
        type: r.event_type,
        payload: JSON.parse(r.payload_json),
        created_at: r.created_at,
      })),
      next_seq: nextSeq,
      has_more: hasMore,
    };
  }

  /**
   * Subscribe to events for a room. Returns an unsubscribe function.
   */
  subscribe(roomId: string, callback: EventCallback): () => void {
    if (!this.subscribers.has(roomId)) {
      this.subscribers.set(roomId, new Set());
    }
    this.subscribers.get(roomId)!.add(callback);

    return () => {
      const subs = this.subscribers.get(roomId);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(roomId);
        }
      }
    };
  }

  /**
   * Notify all subscribers of a new event in a room.
   */
  notify(roomId: string, seq: number, type: string, payload: string): void {
    const subs = this.subscribers.get(roomId);
    if (subs) {
      for (const cb of subs) {
        cb({ seq, type, payload });
      }
    }
  }

  /**
   * Get the latest sequence number for a room.
   */
  getLatestSeq(roomId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(seq) as max_seq FROM events WHERE room_id = ?`)
      .get(roomId) as { max_seq: number | null };
    return row?.max_seq ?? 0;
  }
}
