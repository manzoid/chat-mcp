import { Hono } from "hono";
import { randomBytes, createHash } from "crypto";
import { Database } from "bun:sqlite";
import { loadPublicKey, verifyData } from "@chat-mcp/shared";
import type { AppEnv } from "./app.js";
import { ParticipantRepo } from "./db/repos.js";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuthRoutes() {
  const auth = new Hono<AppEnv>();

  auth.post("/challenge", async (c) => {
    const { participant_id } = await c.req.json();
    if (!participant_id) {
      return c.json({ error: { code: "invalid_request", message: "participant_id required" } }, 400);
    }
    const participant = c.get("repos").participants.getById(participant_id);
    if (!participant) {
      return c.json({ error: { code: "not_found", message: "Participant not found" } }, 404);
    }
    const challenge = randomBytes(32).toString("base64");
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    c.get("db").run(
      "INSERT INTO challenges (challenge, participant_id, expires_at) VALUES (?, ?, ?)",
      [challenge, participant_id, expiresAt]
    );
    return c.json({ challenge });
  });

  auth.post("/verify", async (c) => {
    const { participant_id, signed_challenge } = await c.req.json();
    if (!participant_id || !signed_challenge) {
      return c.json({ error: { code: "invalid_request", message: "Missing fields" } }, 400);
    }

    // Find a valid challenge for this participant
    const row = c.get("db").query(
      `SELECT challenge FROM challenges
       WHERE participant_id = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY created_at DESC LIMIT 1`
    ).get(participant_id) as { challenge: string } | null;

    if (!row) {
      return c.json({ error: { code: "invalid_challenge", message: "No valid challenge found" } }, 400);
    }

    // Verify the signature
    const participant = c.get("repos").participants.getById(participant_id);
    if (!participant) {
      return c.json({ error: { code: "not_found", message: "Participant not found" } }, 404);
    }

    let publicKey;
    try {
      publicKey = loadPublicKey(participant.public_key_pem);
    } catch {
      return c.json({ error: { code: "invalid_key", message: "Invalid public key on file" } }, 500);
    }

    const challengeData = Buffer.from(row.challenge);
    const valid = verifyData(publicKey, signed_challenge, challengeData);

    if (!valid) {
      return c.json({ error: { code: "auth_failed", message: "Signature verification failed" } }, 401);
    }

    // Delete used challenge
    c.get("db").run("DELETE FROM challenges WHERE challenge = ?", [row.challenge]);

    // Create session token
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    c.get("db").run(
      "INSERT INTO sessions (token_hash, participant_id, expires_at) VALUES (?, ?, ?)",
      [tokenHash, participant_id, expiresAt]
    );

    return c.json({ session_token: token, expires_at: expiresAt });
  });

  auth.post("/revoke", async (c) => {
    const pid = c.get("participantId");
    c.get("db").run("DELETE FROM sessions WHERE participant_id = ?", [pid]);
    return c.json({ ok: true });
  });

  return auth;
}

/**
 * Auth middleware: verify Bearer token from Authorization header.
 * Sets participantId in context.
 */
export function authMiddleware(skipPaths: string[] = []) {
  return async (c: any, next: () => Promise<void>) => {
    const path = new URL(c.req.url).pathname;
    if (skipPaths.some((p) => path.startsWith(p))) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: { code: "unauthorized", message: "Missing or invalid Authorization header" } }, 401);
    }
    const token = authHeader.slice(7);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const session = c.get("db").query(
      `SELECT participant_id FROM sessions
       WHERE token_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).get(tokenHash) as { participant_id: string } | null;

    if (!session) {
      return c.json({ error: { code: "unauthorized", message: "Invalid or expired token" } }, 401);
    }

    c.set("participantId", session.participant_id);
    await next();
  };
}

/**
 * Verify a message signature against the author's public key.
 */
export function verifyMessageSignature(
  db: Database,
  authorId: string,
  signature: string,
  payloadHash: Buffer
): boolean {
  const row = db.query("SELECT public_key_pem FROM participants WHERE id = ?").get(authorId) as { public_key_pem: string } | null;
  if (!row) return false;
  try {
    const pubKey = loadPublicKey(row.public_key_pem);
    return verifyData(pubKey, signature, payloadHash);
  } catch {
    return false;
  }
}
