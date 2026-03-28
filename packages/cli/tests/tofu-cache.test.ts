import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateKeyPair } from "@chat-mcp/shared";

// We need to mock the config dir to avoid polluting the real config.
// The TOFU cache module reads getConfigDir() — we'll test the logic directly.
// Instead of importing the module (which hardcodes the path), test the core logic.

import { getKeyFingerprint } from "@chat-mcp/shared";

interface TofuEntry {
  publicKeyPem: string;
  fingerprint: string;
  displayName: string;
  firstSeen: string;
  lastSeen: string;
}

// In-memory TOFU implementation for testing (mirrors tofu-cache.ts logic)
function createTofuCache() {
  const cache = new Map<string, TofuEntry>();

  function checkKey(participantId: string, publicKeyPem: string, displayName: string) {
    const fingerprint = getKeyFingerprint(publicKeyPem);
    const now = new Date().toISOString();

    const existing = cache.get(participantId);

    if (!existing) {
      const entry: TofuEntry = { publicKeyPem, fingerprint, displayName, firstSeen: now, lastSeen: now };
      cache.set(participantId, entry);
      return { status: "new" as const, entry };
    }

    if (existing.fingerprint === fingerprint) {
      existing.lastSeen = now;
      return { status: "trusted" as const, entry: existing };
    }

    return { status: "changed" as const, previousEntry: existing, newFingerprint: fingerprint };
  }

  function acceptNewKey(participantId: string, publicKeyPem: string, displayName: string) {
    const fingerprint = getKeyFingerprint(publicKeyPem);
    const now = new Date().toISOString();
    const entry: TofuEntry = { publicKeyPem, fingerprint, displayName, firstSeen: now, lastSeen: now };
    cache.set(participantId, entry);
    return entry;
  }

  return { checkKey, acceptNewKey, cache };
}

describe("TOFU key cache", () => {
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const rotatedAlice = generateKeyPair(); // Simulates key rotation

  test("first check returns 'new' and caches the key", () => {
    const tofu = createTofuCache();
    const result = tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    expect(result.status).toBe("new");
    expect(result.entry.displayName).toBe("alice");
    expect(result.entry.fingerprint).toBeTruthy();
    expect(tofu.cache.size).toBe(1);
  });

  test("second check with same key returns 'trusted'", () => {
    const tofu = createTofuCache();
    tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    const result = tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    expect(result.status).toBe("trusted");
  });

  test("different participants are tracked independently", () => {
    const tofu = createTofuCache();
    const r1 = tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    const r2 = tofu.checkKey("p-bob", bob.publicKeyPem, "bob");
    expect(r1.status).toBe("new");
    expect(r2.status).toBe("new");
    expect(tofu.cache.size).toBe(2);
  });

  test("key change returns 'changed' with previous fingerprint", () => {
    const tofu = createTofuCache();
    tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    const result = tofu.checkKey("p-alice", rotatedAlice.publicKeyPem, "alice");
    expect(result.status).toBe("changed");
    if (result.status === "changed") {
      expect(result.previousEntry.fingerprint).toBeTruthy();
      expect(result.newFingerprint).toBeTruthy();
      expect(result.previousEntry.fingerprint).not.toBe(result.newFingerprint);
    }
  });

  test("acceptNewKey overwrites previous key", () => {
    const tofu = createTofuCache();
    tofu.checkKey("p-alice", alice.publicKeyPem, "alice");

    // Key changed
    const changed = tofu.checkKey("p-alice", rotatedAlice.publicKeyPem, "alice");
    expect(changed.status).toBe("changed");

    // Accept the new key
    tofu.acceptNewKey("p-alice", rotatedAlice.publicKeyPem, "alice");

    // Now it's trusted
    const result = tofu.checkKey("p-alice", rotatedAlice.publicKeyPem, "alice");
    expect(result.status).toBe("trusted");
  });

  test("fingerprints are deterministic for the same key", () => {
    const tofu = createTofuCache();
    const r1 = tofu.checkKey("p-alice", alice.publicKeyPem, "alice");
    expect(r1.status).toBe("new");
    const fp1 = r1.entry.fingerprint;

    // New cache instance, same key
    const tofu2 = createTofuCache();
    const r2 = tofu2.checkKey("p-alice", alice.publicKeyPem, "alice");
    expect(r2.entry.fingerprint).toBe(fp1);
  });
});
