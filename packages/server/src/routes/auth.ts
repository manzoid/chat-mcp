import { Hono } from "hono";
import type { AuthService } from "../services/auth.js";

export function authRoutes(authService: AuthService) {
  const app = new Hono();

  app.post("/register", async (c) => {
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
    const participantId = c.get("participantId" as never);
    if (!participantId) {
      return c.json(
        { error: { code: "unauthorized", message: "Not authenticated" } },
        401,
      );
    }
    authService.revokeAllSessions(participantId as string);
    return c.body(null, 204);
  });

  return app;
}
