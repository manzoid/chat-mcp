import { canonicalJsonHash } from "./canonical-json.js";
import { signData, verifyData, type KeyObject } from "./ssh-signing.js";

/**
 * Sign a structured payload: canonicalize → SHA-256 → ed25519 sign.
 */
export function signPayload(privateKey: KeyObject, payload: unknown): string {
  const hash = canonicalJsonHash(payload);
  return signData(privateKey, hash);
}

/**
 * Verify a structured payload signature.
 */
export function verifyPayload(
  publicKey: KeyObject,
  signature: string,
  payload: unknown
): boolean {
  const hash = canonicalJsonHash(payload);
  return verifyData(publicKey, signature, hash);
}
