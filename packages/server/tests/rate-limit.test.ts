import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { RateLimiter } from "../src/rate-limit";
import { createDatabase } from "../src/db/connection";
import { createApp } from "../src/app";
import { Database } from "bun:sqlite";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.stop();
  });

  test("allows requests under the limit", () => {
    limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      const { allowed, remaining } = limiter.check("user1");
      expect(allowed).toBe(true);
      expect(remaining).toBe(4 - i);
    }
  });

  test("blocks requests over the limit", () => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
    limiter.check("user1");
    limiter.check("user1");
    limiter.check("user1");
    const { allowed, remaining } = limiter.check("user1");
    expect(allowed).toBe(false);
    expect(remaining).toBe(0);
  });

  test("different keys have independent limits", () => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    limiter.check("user1");
    limiter.check("user1");
    const { allowed: blocked } = limiter.check("user1");
    expect(blocked).toBe(false);

    const { allowed: otherAllowed } = limiter.check("user2");
    expect(otherAllowed).toBe(true);
  });

  test("window expiry allows new requests", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });
    limiter.check("user1");
    const { allowed: blocked } = limiter.check("user1");
    expect(blocked).toBe(false);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const { allowed } = limiter.check("user1");
        expect(allowed).toBe(true);
        resolve();
      }, 60);
    });
  });
});

describe("rate limiting middleware integration", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>["app"];
  let rateLimiter: RateLimiter | undefined;

  function req(method: string, path: string, body?: any, participantId: string = "p1") {
    const init: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Participant-Id": participantId,
      },
    };
    if (body) init.body = JSON.stringify(body);
    return app.request(path, init);
  }

  beforeEach(() => {
    db = createDatabase(":memory:");
    const result = createApp(db, { rateLimit: { maxRequests: 3, windowMs: 60_000 } });
    app = result.app;
    rateLimiter = result.rateLimiter;
    db.run(
      "INSERT INTO participants (id, display_name, type, public_key_pem) VALUES (?, ?, ?, ?)",
      ["p1", "alice", "human", "key1"]
    );
    db.run("INSERT INTO presence (participant_id, state) VALUES (?, 'online')", ["p1"]);
  });

  afterEach(() => {
    rateLimiter?.stop();
  });

  test("allows requests under limit", async () => {
    const res = await req("GET", "/health");
    expect(res.status).toBe(200);
  });

  test("returns 429 when limit exceeded", async () => {
    // Health is excluded from rate limiting, use /rooms instead
    const r1 = await req("GET", "/rooms");
    expect(r1.status).toBe(200);
    const r2 = await req("GET", "/rooms");
    expect(r2.status).toBe(200);
    const r3 = await req("GET", "/rooms");
    expect(r3.status).toBe(200);
    const r4 = await req("GET", "/rooms");
    expect(r4.status).toBe(429);
    const body = await r4.json();
    expect(body.error.code).toBe("rate_limited");
  });

  test("includes rate limit headers", async () => {
    const res = await req("GET", "/rooms");
    expect(res.headers.get("X-RateLimit-Remaining")).toBeTruthy();
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  test("health endpoint bypasses rate limiting", async () => {
    // Exhaust the limit
    await req("GET", "/rooms");
    await req("GET", "/rooms");
    await req("GET", "/rooms");

    // Health should still work
    const res = await req("GET", "/health");
    expect(res.status).toBe(200);
  });
});
