import { describe, test, expect } from "bun:test";
import {
  signData,
  verifyData,
  generateKeyPair,
  loadPrivateKey,
  loadPublicKey,
  derivePublicKey,
  getKeyFingerprint,
  generateNonce,
} from "../src/ssh-signing";
import { signPayload, verifyPayload } from "../src/signing";
import { canonicalJsonHash } from "../src/canonical-json";

function makeKeys() {
  const { privateKeyPem, publicKeyPem } = generateKeyPair();
  return {
    privateKey: loadPrivateKey(privateKeyPem),
    publicKey: loadPublicKey(publicKeyPem),
    publicKeyPem,
  };
}

describe("generateKeyPair", () => {
  test("creates PEM-encoded keypair", () => {
    const { privateKeyPem, publicKeyPem } = generateKeyPair();
    expect(privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });
});

describe("signData + verifyData", () => {
  test("sign and verify a buffer", () => {
    const { privateKey, publicKey } = makeKeys();
    const data = Buffer.from("hello world");
    const sig = signData(privateKey, data);
    expect(typeof sig).toBe("string");
    expect(verifyData(publicKey, sig, data)).toBe(true);
  });

  test("verification fails with tampered data", () => {
    const { privateKey, publicKey } = makeKeys();
    const data = Buffer.from("original");
    const sig = signData(privateKey, data);
    expect(verifyData(publicKey, sig, Buffer.from("tampered"))).toBe(false);
  });

  test("verification fails with wrong key", () => {
    const keys1 = makeKeys();
    const keys2 = makeKeys();
    const data = Buffer.from("test");
    const sig = signData(keys1.privateKey, data);
    expect(verifyData(keys2.publicKey, sig, data)).toBe(false);
  });
});

describe("derivePublicKey", () => {
  test("derives matching public key from private key", () => {
    const { privateKey, publicKey } = makeKeys();
    const derived = derivePublicKey(privateKey);
    const data = Buffer.from("test");
    const sig = signData(privateKey, data);
    expect(verifyData(derived, sig, data)).toBe(true);
  });
});

describe("signPayload + verifyPayload", () => {
  test("sign and verify a structured message payload", () => {
    const { privateKey, publicKey } = makeKeys();
    const payload = {
      room_id: "room-abc",
      content: { format: "markdown", text: "Hello team!" },
      thread_id: null,
      mentions: [],
      attachments: [],
      timestamp: "2026-03-28T09:00:00Z",
      nonce: "unique-nonce-123",
    };

    const sig = signPayload(privateKey, payload);
    expect(verifyPayload(publicKey, sig, payload)).toBe(true);
  });

  test("verification fails when payload is tampered", () => {
    const { privateKey, publicKey } = makeKeys();
    const payload = {
      room_id: "room-abc",
      content: { format: "markdown", text: "Hello" },
      thread_id: null,
      mentions: [],
      attachments: [],
      timestamp: "2026-03-28T09:00:00Z",
      nonce: "nonce-1",
    };

    const sig = signPayload(privateKey, payload);
    const tampered = { ...payload, content: { format: "markdown", text: "Hacked!" } };
    expect(verifyPayload(publicKey, sig, tampered)).toBe(false);
  });

  test("key order doesn't matter (canonical JSON)", () => {
    const { privateKey, publicKey } = makeKeys();
    const payload1 = { z: 1, a: 2 };
    const payload2 = { a: 2, z: 1 };

    const sig = signPayload(privateKey, payload1);
    expect(verifyPayload(publicKey, sig, payload2)).toBe(true);
  });
});

describe("getKeyFingerprint", () => {
  test("returns a hex string", () => {
    const { publicKeyPem } = generateKeyPair();
    const fp = getKeyFingerprint(publicKeyPem);
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
  });

  test("same key produces same fingerprint", () => {
    const { publicKeyPem } = generateKeyPair();
    expect(getKeyFingerprint(publicKeyPem)).toBe(getKeyFingerprint(publicKeyPem));
  });

  test("different keys produce different fingerprints", () => {
    const k1 = generateKeyPair();
    const k2 = generateKeyPair();
    expect(getKeyFingerprint(k1.publicKeyPem)).not.toBe(
      getKeyFingerprint(k2.publicKeyPem)
    );
  });
});

describe("generateNonce", () => {
  test("produces 32-char hex string", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[a-f0-9]{32}$/);
  });

  test("produces unique values", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});
