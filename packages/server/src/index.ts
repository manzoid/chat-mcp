import { createDatabase } from "./db/connection.js";
import { createApp } from "./app.js";

const port = parseInt(process.env.PORT || "8080");
const dbPath = process.env.DB_PATH || "./chat.db";
const requireAuth = process.env.REQUIRE_AUTH === "true";
const verifySignatures = process.env.VERIFY_SIGNATURES === "true";
const enforceNonces = process.env.ENFORCE_NONCES === "true";
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || "0");

const db = createDatabase(dbPath);
const { app, rateLimiter } = createApp(db, {
  requireAuth,
  verifySignatures,
  enforceNonces,
  rateLimit: rateLimitMax > 0 ? { maxRequests: rateLimitMax } : undefined,
});

console.log(`Chat MCP server starting on port ${port}`);
if (requireAuth) console.log("  Auth: enabled (Bearer token)");
if (verifySignatures) console.log("  Signature verification: enabled");
if (enforceNonces) console.log("  Nonce enforcement: enabled");
if (rateLimitMax > 0) console.log(`  Rate limit: ${rateLimitMax} req/min`);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  rateLimiter?.stop();
  server.stop();
  db.close();
  console.log("Server stopped.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
