import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { sign, verify, fingerprint } from "../src/signing.js";

describe("SSH signing", () => {
  let tmpDir: string;
  let privateKeyPath: string;
  let publicKey: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "chat-mcp-test-keys-"));
    privateKeyPath = join(tmpDir, "test_key");

    // Generate a test ed25519 keypair
    execFileSync("ssh-keygen", [
      "-t",
      "ed25519",
      "-f",
      privateKeyPath,
      "-N",
      "", // no passphrase
      "-C",
      "test@chat-mcp",
    ]);

    publicKey = execFileSync("cat", [privateKeyPath + ".pub"], {
      encoding: "utf-8",
    }).trim();
  });

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sign and verify round-trip succeeds", async () => {
    const payload = { message: "hello", nonce: "abc123" };
    const sig = await sign(privateKeyPath, payload);

    expect(sig).toContain("-----BEGIN SSH SIGNATURE-----");
    expect(sig).toContain("-----END SSH SIGNATURE-----");

    const valid = await verify(publicKey, payload, sig, "test@chat-mcp");
    expect(valid).toBe(true);
  });

  it("verify rejects tampered payload", async () => {
    const payload = { message: "hello", nonce: "abc123" };
    const sig = await sign(privateKeyPath, payload);

    const tampered = { message: "goodbye", nonce: "abc123" };
    const valid = await verify(publicKey, tampered, sig, "test@chat-mcp");
    expect(valid).toBe(false);
  });

  it("verify rejects wrong public key", async () => {
    const payload = { message: "hello", nonce: "abc123" };
    const sig = await sign(privateKeyPath, payload);

    // Generate a different keypair
    const otherKeyPath = join(tmpDir, "other_key");
    execFileSync("ssh-keygen", [
      "-t",
      "ed25519",
      "-f",
      otherKeyPath,
      "-N",
      "",
      "-C",
      "other@chat-mcp",
    ]);
    const otherPublicKey = execFileSync("cat", [otherKeyPath + ".pub"], {
      encoding: "utf-8",
    }).trim();

    const valid = await verify(
      otherPublicKey,
      payload,
      sig,
      "test@chat-mcp",
    );
    expect(valid).toBe(false);
  });

  it("sign produces different signatures for different payloads", async () => {
    const sig1 = await sign(privateKeyPath, { a: 1 });
    const sig2 = await sign(privateKeyPath, { a: 2 });
    expect(sig1).not.toBe(sig2);
  });

  it("sign produces consistent canonicalization", async () => {
    // Same payload in different key order should produce verifiable signature
    const payload1 = { b: 2, a: 1 };
    const sig = await sign(privateKeyPath, payload1);

    const payload2 = { a: 1, b: 2 };
    const valid = await verify(publicKey, payload2, sig, "test@chat-mcp");
    expect(valid).toBe(true);
  });

  it("handles complex nested payloads", async () => {
    const payload = {
      room_id: "room-123",
      content: { format: "plain", text: "hello world" },
      thread_id: null,
      mentions: ["user-1", "user-2"],
      attachments: [],
      nonce: "test-nonce-uuid",
      timestamp: "2025-01-01T00:00:00.000Z",
    };

    const sig = await sign(privateKeyPath, payload);
    const valid = await verify(publicKey, payload, sig, "test@chat-mcp");
    expect(valid).toBe(true);
  });

  it("fingerprint returns SHA256 hash", async () => {
    const fp = await fingerprint(publicKey);
    expect(fp).toMatch(/^SHA256:/);
  });
});
