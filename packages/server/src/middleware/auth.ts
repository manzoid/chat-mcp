import type { MiddlewareHandler } from "hono";
import type { AuthService } from "../services/auth.js";

export function bearerAuth(authService: AuthService): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        { error: { code: "unauthorized", message: "Missing or invalid Authorization header" } },
        401,
      );
    }

    const token = authHeader.slice(7);
    const participantId = authService.validateToken(token);

    if (!participantId) {
      return c.json(
        { error: { code: "unauthorized", message: "Invalid or expired token" } },
        401,
      );
    }

    c.set("participantId" as never, participantId as never);
    await next();
  };
}
