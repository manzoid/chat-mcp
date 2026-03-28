import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "crypto";

export type { KeyObject } from "crypto";

/**
 * Sign data with an ed25519 private key.
 * Returns a base64-encoded signature.
 */
export function signData(privateKey: KeyObject, data: Buffer): string {
  const sig = sign(null, data, privateKey);
  return sig.toString("base64");
}

/**
 * Verify a signature against an ed25519 public key.
 */
export function verifyData(
  publicKey: KeyObject,
  signature: string,
  data: Buffer
): boolean {
  try {
    return verify(null, data, publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/**
 * Load a private key from PEM string.
 */
export function loadPrivateKey(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/**
 * Load a public key from PEM string.
 */
export function loadPublicKey(pem: string): KeyObject {
  return createPublicKey(pem);
}

/**
 * Derive a public key from a private key.
 */
export function derivePublicKey(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey);
}

/**
 * Generate a new ed25519 keypair. Returns PEM-encoded strings.
 */
export function generateKeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

/**
 * SHA-256 fingerprint of a public key PEM (hex-encoded).
 */
export function getKeyFingerprint(publicKeyPem: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(publicKeyPem);
  return hasher.digest("hex");
}

/**
 * Generate a random nonce for message signing.
 */
export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}
