import { describe, test, expect } from "bun:test";
import { canonicalJson, canonicalJsonHash } from "../src/canonical-json";

describe("canonicalJson", () => {
  test("sorts object keys", () => {
    expect(canonicalJson({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  test("handles nested objects with sorted keys", () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe(
      '{"a":3,"b":{"c":2,"d":1}}'
    );
  });

  test("handles null", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  test("handles arrays (order preserved)", () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  test("handles empty object", () => {
    expect(canonicalJson({})).toBe("{}");
  });

  test("handles empty array", () => {
    expect(canonicalJson([])).toBe("[]");
  });

  test("handles strings with special characters", () => {
    expect(canonicalJson({ a: 'hello "world"' })).toBe(
      '{"a":"hello \\"world\\""}'
    );
  });

  test("handles booleans", () => {
    expect(canonicalJson({ a: true, b: false })).toBe('{"a":true,"b":false}');
  });

  test("handles numbers including zero and negative", () => {
    expect(canonicalJson({ a: 0, b: -1, c: 1.5 })).toBe(
      '{"a":0,"b":-1,"c":1.5}'
    );
  });

  test("throws on undefined input", () => {
    expect(() => canonicalJson(undefined)).toThrow();
  });

  test("produces consistent output for SignedMessagePayload shape", () => {
    const payload = {
      room_id: "room-1",
      content: { format: "markdown", text: "hello" },
      thread_id: null,
      mentions: ["user-1"],
      attachments: [],
      timestamp: "2026-03-28T09:00:00Z",
      nonce: "abc123",
    };
    const result = canonicalJson(payload);
    // Verify key ordering
    expect(result).toMatch(/^{"attachments".*"content".*"mentions".*"nonce".*"room_id".*"thread_id".*"timestamp"/);
    // Verify deterministic
    expect(canonicalJson(payload)).toBe(result);
  });
});

describe("canonicalJsonHash", () => {
  test("produces a 32-byte buffer", () => {
    const hash = canonicalJsonHash({ test: true });
    expect(hash.length).toBe(32);
  });

  test("same input produces same hash", () => {
    const a = canonicalJsonHash({ x: 1, y: 2 });
    const b = canonicalJsonHash({ y: 2, x: 1 });
    expect(a.toString("hex")).toBe(b.toString("hex"));
  });

  test("different input produces different hash", () => {
    const a = canonicalJsonHash({ x: 1 });
    const b = canonicalJsonHash({ x: 2 });
    expect(a.toString("hex")).not.toBe(b.toString("hex"));
  });
});
