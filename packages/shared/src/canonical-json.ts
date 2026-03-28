import canonicalize from "canonicalize";

/**
 * Produce canonical JSON bytes per RFC 8785 (JCS).
 * This is the single most critical function in the system —
 * if it produces different bytes in any context, signatures break.
 */
export function canonicalJson(obj: unknown): string {
  const result = canonicalize(obj);
  if (result === undefined) {
    throw new Error("Cannot canonicalize undefined");
  }
  return result;
}

/**
 * Produce the SHA-256 hash of the canonical JSON representation.
 */
export function canonicalJsonHash(obj: unknown): Buffer {
  const json = canonicalJson(obj);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(json);
  return Buffer.from(hasher.digest());
}
