import { describe, it, expect } from "vitest";
import { canonicalize } from "../src/canonical-json.js";

describe("canonical-json (RFC 8785 / JCS)", () => {
  it("serializes null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("serializes booleans", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("serializes numbers", () => {
    expect(canonicalize(0)).toBe("0");
    expect(canonicalize(-0)).toBe("0"); // -0 normalizes to 0
    expect(canonicalize(1)).toBe("1");
    expect(canonicalize(-1)).toBe("-1");
    expect(canonicalize(3.14)).toBe("3.14");
    expect(canonicalize(1e20)).toBe("100000000000000000000");
    expect(canonicalize(1e-7)).toBe("1e-7");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(-Infinity)).toThrow();
    expect(() => canonicalize(NaN)).toThrow();
  });

  it("serializes simple strings", () => {
    expect(canonicalize("hello")).toBe('"hello"');
    expect(canonicalize("")).toBe('""');
  });

  it("escapes control characters in strings", () => {
    expect(canonicalize("\b")).toBe('"\\b"');
    expect(canonicalize("\t")).toBe('"\\t"');
    expect(canonicalize("\n")).toBe('"\\n"');
    expect(canonicalize("\f")).toBe('"\\f"');
    expect(canonicalize("\r")).toBe('"\\r"');
    expect(canonicalize('"')).toBe('"\\""');
    expect(canonicalize("\\")).toBe('"\\\\"');
  });

  it("escapes low control characters as \\uXXXX", () => {
    expect(canonicalize("\x00")).toBe('"\\u0000"');
    expect(canonicalize("\x01")).toBe('"\\u0001"');
    expect(canonicalize("\x1f")).toBe('"\\u001f"');
  });

  it("does not escape printable characters", () => {
    expect(canonicalize("/")).toBe('"/"'); // no \\/ unlike some implementations
    expect(canonicalize("abc")).toBe('"abc"');
  });

  it("serializes empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  it("serializes array with mixed types", () => {
    expect(canonicalize([1, "two", null, true])).toBe('[1,"two",null,true]');
  });

  it("serializes nested arrays", () => {
    expect(canonicalize([[1, 2], [3]])).toBe("[[1,2],[3]]");
  });

  it("serializes empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  it("sorts object keys lexicographically", () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalize({ z: 1, a: 1, m: 1 })).toBe('{"a":1,"m":1,"z":1}');
  });

  it("handles unicode key sorting correctly", () => {
    // Unicode code point order, not locale order
    expect(canonicalize({ "\u20ac": 1, "\r": 2 })).toBe(
      '{"\\r":2,"\u20ac":1}',
    );
  });

  it("preserves null values in objects", () => {
    expect(canonicalize({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it("serializes nested objects with sorted keys", () => {
    const input = {
      z: { b: 2, a: 1 },
      a: "first",
    };
    expect(canonicalize(input)).toBe('{"a":"first","z":{"a":1,"b":2}}');
  });

  it("handles the protocol SignedMessagePayload shape", () => {
    const payload = {
      room_id: "room-123",
      content: { format: "plain", text: "hello" },
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce: "nonce-abc",
      timestamp: "2025-01-01T00:00:00Z",
    };
    const result = canonicalize(payload);
    // Keys sorted: attachments, content, mentions, nonce, room_id, thread_id, timestamp
    // Content keys sorted: format, text
    expect(result).toBe(
      '{"attachments":[],"content":{"format":"plain","text":"hello"},"mentions":[],"nonce":"nonce-abc","room_id":"room-123","thread_id":null,"timestamp":"2025-01-01T00:00:00Z"}',
    );
  });

  it("produces deterministic output regardless of insertion order", () => {
    const a = canonicalize({ x: 1, y: 2, z: 3 });
    const b = canonicalize({ z: 3, x: 1, y: 2 });
    const c = canonicalize({ y: 2, z: 3, x: 1 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
