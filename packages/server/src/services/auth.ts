import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import { randomBytes } from "node:crypto";
import { verify, fingerprint } from "@chat-mcp/shared";
import { SESSION_TOKEN_TTL_MS } from "@chat-mcp/shared";

export class AuthService {
  constructor(private db: Database.Database) {}

  async register(
    displayName: string,
    type: "human" | "agent",
    publicKey: string,
    pairedWith?: string,
  ): Promise<string> {
    const id = uuid();
    const fp = await fingerprint(publicKey);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO participants (id, display_name, type, paired_with) VALUES (?, ?, ?, ?)`,
      )
      .run(id, displayName, type, pairedWith ?? null);

    this.db
      .prepare(
        `INSERT INTO key_history (participant_id, public_key, fingerprint, valid_from) VALUES (?, ?, ?, ?)`,
      )
      .run(id, publicKey, fp, now);

    return id;
  }

  createChallenge(participantId: string): string {
    const participant = this.db
      .prepare(`SELECT id FROM participants WHERE id = ?`)
      .get(participantId) as { id: string } | undefined;

    if (!participant) {
      throw new Error("Participant not found");
    }

    const challenge = randomBytes(32).toString("hex");
    const id = uuid();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    this.db
      .prepare(
        `INSERT INTO challenges (id, participant_id, challenge, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(id, participantId, challenge, expiresAt);

    return challenge;
  }

  async verifyChallenge(
    participantId: string,
    signedChallenge: string,
  ): Promise<{ sessionToken: string; expiresAt: string }> {
    const row = this.db
      .prepare(
        `SELECT challenge FROM challenges
         WHERE participant_id = ? AND expires_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(participantId, new Date().toISOString()) as
      | { challenge: string }
      | undefined;

    if (!row) {
      throw new Error("No valid challenge found");
    }

    const keyRow = this.db
      .prepare(
        `SELECT public_key FROM key_history
         WHERE participant_id = ? AND valid_until IS NULL`,
      )
      .get(participantId) as { public_key: string } | undefined;

    if (!keyRow) {
      throw new Error("No active key found");
    }

    // The challenge is signed as a plain object with the challenge string
    const valid = await verify(
      keyRow.public_key,
      { challenge: row.challenge },
      signedChallenge,
      participantId,
    );

    if (!valid) {
      throw new Error("Invalid signature");
    }

    // Clean up used challenges
    this.db
      .prepare(`DELETE FROM challenges WHERE participant_id = ?`)
      .run(participantId);

    // Create session token
    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TOKEN_TTL_MS).toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (token, participant_id, expires_at) VALUES (?, ?, ?)`,
      )
      .run(sessionToken, participantId, expiresAt);

    return { sessionToken, expiresAt };
  }

  validateToken(token: string): string | null {
    const row = this.db
      .prepare(
        `SELECT participant_id FROM sessions WHERE token = ? AND expires_at > ?`,
      )
      .get(token, new Date().toISOString()) as
      | { participant_id: string }
      | undefined;

    return row?.participant_id ?? null;
  }

  revokeAllSessions(participantId: string): void {
    this.db
      .prepare(`DELETE FROM sessions WHERE participant_id = ?`)
      .run(participantId);
  }

  getActiveKey(participantId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT public_key FROM key_history WHERE participant_id = ? AND valid_until IS NULL`,
      )
      .get(participantId) as { public_key: string } | undefined;
    return row?.public_key ?? null;
  }

  getParticipant(participantId: string) {
    return this.db
      .prepare(`SELECT * FROM participants WHERE id = ?`)
      .get(participantId) as Record<string, unknown> | undefined;
  }
}
