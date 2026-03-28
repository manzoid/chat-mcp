/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS)
 *
 * Produces deterministic JSON output for signature verification.
 * Rules:
 * - Object keys sorted lexicographically by Unicode code point
 * - No whitespace between tokens
 * - Numbers serialized per ES2015 Number.toString()
 * - Strings use minimal escape sequences (only characters that MUST be escaped)
 * - null fields are included (not omitted)
 * - No trailing commas, no comments
 */

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    if (!isFinite(value)) {
      throw new Error("JCS: non-finite numbers are not allowed");
    }
    // ES2015 Number.toString() is the canonical form per RFC 8785
    return Object.is(value, -0) ? "0" : String(value);
  }

  if (typeof value === "string") {
    return serializeString(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return "[" + items.join(",") + "]";
  }

  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map((key) => {
      const v = (value as Record<string, unknown>)[key];
      return serializeString(key) + ":" + canonicalize(v);
    });
    return "{" + pairs.join(",") + "}";
  }

  throw new Error(`JCS: unsupported type ${typeof value}`);
}

function serializeString(s: string): string {
  let result = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    switch (ch) {
      case 0x08:
        result += "\\b";
        break;
      case 0x09:
        result += "\\t";
        break;
      case 0x0a:
        result += "\\n";
        break;
      case 0x0c:
        result += "\\f";
        break;
      case 0x0d:
        result += "\\r";
        break;
      case 0x22:
        result += '\\"';
        break;
      case 0x5c:
        result += "\\\\";
        break;
      default:
        if (ch < 0x20) {
          result += "\\u" + ch.toString(16).padStart(4, "0");
        } else {
          result += s[i];
        }
    }
  }
  result += '"';
  return result;
}
