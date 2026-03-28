import { Hono } from "hono";
import { PROTOCOL_VERSION, MIN_PROTOCOL_VERSION } from "@chat-mcp/shared";

const startTime = Date.now();

export function healthRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      status: "ok",
      protocol_version: PROTOCOL_VERSION,
      min_protocol_version: MIN_PROTOCOL_VERSION,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  return app;
}
