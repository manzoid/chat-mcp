import type { MiddlewareHandler } from "hono";
import {
  PROTOCOL_VERSION,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  MIN_PROTOCOL_VERSION_HEADER,
} from "@chat-mcp/shared";

export function protocolVersion(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header(PROTOCOL_VERSION_HEADER, String(PROTOCOL_VERSION));
    c.header(MIN_PROTOCOL_VERSION_HEADER, String(MIN_PROTOCOL_VERSION));
  };
}
