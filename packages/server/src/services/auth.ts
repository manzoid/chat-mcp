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
    role: "super" | "admin" | "user" = "user",
  ): Promise<string> {
    const id = uuid();
    const fp = await fingerprint(publicKey);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO participants (id, display_name, type, role, paired_with) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, displayName, type, role, pairedWith ?? null);

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

  async rotateKey(participantId: string, newPublicKey: string): Promise<void> {
    const fp = await fingerprint(newPublicKey);
    const now = new Date().toISOString();

    // Expire the current key
    this.db
      .prepare(
        `UPDATE key_history SET valid_until = ? WHERE participant_id = ? AND valid_until IS NULL`,
      )
      .run(now, participantId);

    // Insert new key
    this.db
      .prepare(
        `INSERT INTO key_history (participant_id, public_key, fingerprint, valid_from) VALUES (?, ?, ?, ?)`,
      )
      .run(participantId, newPublicKey, fp, now);

    // Revoke all sessions (force re-auth with new key)
    this.revokeAllSessions(participantId);
  }

  getKeyAtTime(participantId: string, timestamp: string): string | null {
    const row = this.db
      .prepare(
        `SELECT public_key FROM key_history
         WHERE participant_id = ?
         AND valid_from <= ?
         AND (valid_until IS NULL OR valid_until > ?)
         ORDER BY valid_from DESC LIMIT 1`,
      )
      .get(participantId, timestamp, timestamp) as { public_key: string } | undefined;
    return row?.public_key ?? null;
  }

  getParticipantRole(participantId: string): "super" | "admin" | "user" {
    const row = this.db
      .prepare(`SELECT role FROM participants WHERE id = ?`)
      .get(participantId) as { role: string } | undefined;
    return (row?.role as "super" | "admin" | "user") ?? "user";
  }

  isAdmin(participantId: string): boolean {
    const role = this.getParticipantRole(participantId);
    return role === "admin" || role === "super";
  }

  async bootstrapSuperAdmin(publicKey: string): Promise<string> {
    // Check if a super admin already exists
    const existing = this.db
      .prepare(`SELECT id FROM participants WHERE role = 'super'`)
      .get() as { id: string } | undefined;

    if (existing) return existing.id;

    // Extract display name from SSH key comment (third field) or default
    const parts = publicKey.trim().split(/\s+/);
    const comment = parts[2] ?? "super-admin";
    const displayName = comment.replace(/@.*$/, "") || "super-admin";

    return this.register(displayName, "human", publicKey, undefined, "super");
  }

  createInvite(
    creatorId: string,
    roomIds: string[],
    expiresAt?: string,
  ): string {
    const id = uuid();
    this.db
      .prepare(
        `INSERT INTO invites (id, room_ids, created_by, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(id, JSON.stringify(roomIds), creatorId, expiresAt ?? null);
    return id;
  }

  async consumeInvite(
    inviteId: string,
    displayName: string,
    type: "human" | "agent",
    publicKey: string,
  ): Promise<{ participantId: string; roomIds: string[] }> {
    const invite = this.db
      .prepare(`SELECT * FROM invites WHERE id = ?`)
      .get(inviteId) as Record<string, unknown> | undefined;

    if (!invite) throw new Error("Invite not found");
    if (invite.used_by) throw new Error("Invite already used");
    if (invite.expires_at && new Date(invite.expires_at as string) < new Date()) {
      throw new Error("Invite expired");
    }

    const participantId = await this.register(displayName, type, publicKey);
    const roomIds = JSON.parse(invite.room_ids as string) as string[];

    // Mark invite as used
    this.db
      .prepare(`UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_by IS NULL`)
      .run(participantId, new Date().toISOString(), inviteId);

    // Add to rooms
    for (const roomId of roomIds) {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO room_members (room_id, participant_id, invited_by) VALUES (?, ?, ?)`,
        )
        .run(roomId, participantId, invite.created_by);
    }

    return { participantId, roomIds };
  }

  promoteToAdmin(participantId: string): void {
    this.db
      .prepare(`UPDATE participants SET role = 'admin' WHERE id = ? AND role = 'user'`)
      .run(participantId);
  }

  demoteToUser(participantId: string): void {
    this.db
      .prepare(`UPDATE participants SET role = 'user' WHERE id = ? AND role = 'admin'`)
      .run(participantId);
  }

  deleteParticipant(participantId: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE participant_id = ?`).run(participantId);
    this.db.prepare(`DELETE FROM key_history WHERE participant_id = ?`).run(participantId);
    this.db.prepare(`DELETE FROM room_members WHERE participant_id = ?`).run(participantId);
    this.db.prepare(`DELETE FROM challenges WHERE participant_id = ?`).run(participantId);
    this.db.prepare(`DELETE FROM participants WHERE id = ?`).run(participantId);
  }

  updateDisplayName(participantId: string, newName: string): void {
    this.db
      .prepare(`UPDATE participants SET display_name = ? WHERE id = ?`)
      .run(newName, participantId);
  }

  getInvites(): Record<string, unknown>[] {
    return this.db
      .prepare(`SELECT * FROM invites ORDER BY created_at DESC`)
      .all() as Record<string, unknown>[];
  }

  deleteInvite(inviteId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM invites WHERE id = ? AND used_by IS NULL`)
      .run(inviteId);
    return result.changes > 0;
  }
}
