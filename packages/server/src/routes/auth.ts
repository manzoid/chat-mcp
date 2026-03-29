import { Hono } from "hono";
import type { AuthService } from "../services/auth.js";

function extractParticipantId(authService: AuthService, authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authService.validateToken(authHeader.slice(7));
}

export function authRoutes(authService: AuthService) {
  const app = new Hono();

  // Direct registration — admin only
  app.post("/register", async (c) => {
    const adminId = extractParticipantId(authService, c.req.header("Authorization"));
    if (!adminId || !authService.isAdmin(adminId)) {
      return c.json(
        { error: { code: "forbidden", message: "Admin access required. Use an invite link to register." } },
        403,
      );
    }

    const body = await c.req.json();
    const { display_name, type, public_key, paired_with } = body;

    if (!display_name || !type || !public_key) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing required fields" } },
        400,
      );
    }

    if (type !== "human" && type !== "agent") {
      return c.json(
        { error: { code: "invalid_request", message: "type must be 'human' or 'agent'" } },
        400,
      );
    }

    try {
      const id = await authService.register(display_name, type, public_key, paired_with);
      return c.json({ participant_id: id }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      return c.json(
        { error: { code: "invalid_request", message: msg } },
        400,
      );
    }
  });

  // Register via invite link (public)
  app.post("/invite/:uuid", async (c) => {
    const inviteId = c.req.param("uuid");
    const body = await c.req.json();
    const { display_name, public_key, type } = body;

    if (!display_name || !public_key) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing display_name or public_key" } },
        400,
      );
    }

    try {
      const result = await authService.consumeInvite(
        inviteId,
        display_name,
        type ?? "human",
        public_key,
      );
      return c.json(
        { participant_id: result.participantId, rooms_joined: result.roomIds },
        201,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Invite registration failed";
      const code = msg.includes("not found") ? "not_found"
        : msg.includes("expired") ? "invite_expired"
        : msg.includes("already used") ? "invite_used"
        : "invalid_request";
      const status = msg.includes("not found") ? 404 : 400;
      return c.json({ error: { code, message: msg } }, status);
    }
  });

  app.post("/challenge", async (c) => {
    const body = await c.req.json();
    const { participant_id } = body;

    if (!participant_id) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing participant_id" } },
        400,
      );
    }

    try {
      const challenge = authService.createChallenge(participant_id);
      return c.json({ challenge });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Challenge creation failed";
      return c.json({ error: { code: "not_found", message: msg } }, 404);
    }
  });

  app.post("/verify", async (c) => {
    const body = await c.req.json();
    const { participant_id, signed_challenge } = body;

    if (!participant_id || !signed_challenge) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing required fields" } },
        400,
      );
    }

    try {
      const result = await authService.verifyChallenge(
        participant_id,
        signed_challenge,
      );
      return c.json({
        session_token: result.sessionToken,
        expires_at: result.expiresAt,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      return c.json({ error: { code: "unauthorized", message: msg } }, 401);
    }
  });

  app.post("/revoke", async (c) => {
    const participantId = extractParticipantId(authService, c.req.header("Authorization"));
    if (!participantId) {
      return c.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        401,
      );
    }
    authService.revokeAllSessions(participantId);
    return c.body(null, 204);
  });

  app.put("/keys", async (c) => {
    const participantId = extractParticipantId(authService, c.req.header("Authorization"));
    if (!participantId) {
      return c.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        401,
      );
    }

    const body = await c.req.json();
    const { public_key } = body;

    if (!public_key) {
      return c.json(
        { error: { code: "invalid_request", message: "Missing public_key" } },
        400,
      );
    }

    try {
      await authService.rotateKey(participantId as string, public_key);
      return c.json({ ok: true, message: "Key rotated. All sessions revoked." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Key rotation failed";
      return c.json({ error: { code: "invalid_request", message: msg } }, 400);
    }
  });

  return app;
}
