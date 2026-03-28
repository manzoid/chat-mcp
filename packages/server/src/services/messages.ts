import type Database from "better-sqlite3";
import { verify } from "@chat-mcp/shared";
import { TIMESTAMP_WINDOW_MS } from "@chat-mcp/shared";
import { ChatError, ErrorCodes } from "@chat-mcp/shared";

export class MessageService {
  constructor(private db: Database.Database) {}

  /**
   * Verify a message signature against the author's active public key.
   * Reconstructs the SignedPayload and verifies via ssh-keygen.
   */
  async verifyMessageSignature(
    authorId: string,
    payload: {
      room_id: string;
      content: { format: string; text: string };
      thread_id: string | null;
      mentions: string[];
      attachments: string[];
      nonce: string;
      timestamp: string;
    },
    signature: string,
  ): Promise<void> {
    const keyRow = this.db
      .prepare(
        `SELECT public_key FROM key_history WHERE participant_id = ? AND valid_until IS NULL`,
      )
      .get(authorId) as { public_key: string } | undefined;

    if (!keyRow) {
      throw new ChatError(
        ErrorCodes.INVALID_SIGNATURE,
        "No active public key found for author",
        400,
      );
    }

    const valid = await verify(keyRow.public_key, payload, signature, authorId);
    if (!valid) {
      throw new ChatError(
        ErrorCodes.INVALID_SIGNATURE,
        "Message signature verification failed",
        400,
      );
    }
  }

  /**
   * Check that the sender's timestamp is within the allowed window.
   */
  checkTimestamp(senderTimestamp: string): void {
    const senderTime = new Date(senderTimestamp).getTime();
    const serverTime = Date.now();
    const diff = Math.abs(senderTime - serverTime);

    if (diff > TIMESTAMP_WINDOW_MS) {
      throw new ChatError(
        ErrorCodes.TIMESTAMP_OUT_OF_RANGE,
        `Sender timestamp is ${Math.round(diff / 1000)}s from server time (max ${TIMESTAMP_WINDOW_MS / 1000}s)`,
        400,
      );
    }
  }

  /**
   * Check that the nonce hasn't been used before by this participant.
   * Records the nonce if valid.
   */
  checkAndRecordNonce(participantId: string, nonce: string): void {
    const existing = this.db
      .prepare(
        `SELECT 1 FROM nonces WHERE participant_id = ? AND nonce = ?`,
      )
      .get(participantId, nonce);

    if (existing) {
      throw new ChatError(
        ErrorCodes.DUPLICATE_NONCE,
        "Nonce has already been used",
        400,
      );
    }

    // Record nonce with expiry
    const expiresAt = new Date(
      Date.now() + TIMESTAMP_WINDOW_MS + 60_000,
    ).toISOString(); // window + 1 min margin

    this.db
      .prepare(
        `INSERT INTO nonces (participant_id, nonce, expires_at) VALUES (?, ?, ?)`,
      )
      .run(participantId, nonce, expiresAt);
  }

  /**
   * Garbage-collect expired nonces.
   */
  gcNonces(): number {
    const result = this.db
      .prepare(`DELETE FROM nonces WHERE expires_at < ?`)
      .run(new Date().toISOString());
    return result.changes;
  }
}
