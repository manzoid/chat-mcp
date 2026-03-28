/**
 * Trust On First Use (TOFU) key cache.
 *
 * Stores participant public keys locally so we can detect if a key changes
 * after the first encounter (similar to SSH known_hosts).
 *
 * File format: JSON map of { participantId: { publicKeyPem, fingerprint, firstSeen, displayName } }
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getKeyFingerprint } from "@chat-mcp/shared";
import { getConfigDir } from "./config.js";

export interface TofuEntry {
  publicKeyPem: string;
  fingerprint: string;
  displayName: string;
  firstSeen: string;
  lastSeen: string;
}

export type TofuResult =
  | { status: "trusted"; entry: TofuEntry }
  | { status: "new"; entry: TofuEntry }
  | { status: "changed"; previousEntry: TofuEntry; newFingerprint: string };

const CACHE_FILE = join(getConfigDir(), "known_keys.json");

function loadCache(): Record<string, TofuEntry> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, TofuEntry>): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

/**
 * Check a participant's public key against the TOFU cache.
 *
 * - "new": first time seeing this participant — key is trusted and cached.
 * - "trusted": key matches what we've seen before.
 * - "changed": KEY MISMATCH — potential impersonation or key rotation.
 */
export function checkKey(
  participantId: string,
  publicKeyPem: string,
  displayName: string
): TofuResult {
  const cache = loadCache();
  const fingerprint = getKeyFingerprint(publicKeyPem);
  const now = new Date().toISOString();

  const existing = cache[participantId];

  if (!existing) {
    // First encounter — trust on first use
    const entry: TofuEntry = {
      publicKeyPem,
      fingerprint,
      displayName,
      firstSeen: now,
      lastSeen: now,
    };
    cache[participantId] = entry;
    saveCache(cache);
    return { status: "new", entry };
  }

  if (existing.fingerprint === fingerprint) {
    // Known key, update last seen
    existing.lastSeen = now;
    if (displayName) existing.displayName = displayName;
    saveCache(cache);
    return { status: "trusted", entry: existing };
  }

  // Key changed!
  return {
    status: "changed",
    previousEntry: existing,
    newFingerprint: fingerprint,
  };
}

/**
 * Explicitly accept a new key for a participant (after user confirmation).
 */
export function acceptNewKey(
  participantId: string,
  publicKeyPem: string,
  displayName: string
): TofuEntry {
  const cache = loadCache();
  const fingerprint = getKeyFingerprint(publicKeyPem);
  const now = new Date().toISOString();
  const entry: TofuEntry = {
    publicKeyPem,
    fingerprint,
    displayName,
    firstSeen: now,
    lastSeen: now,
  };
  cache[participantId] = entry;
  saveCache(cache);
  return entry;
}

/**
 * List all cached keys.
 */
export function listCachedKeys(): Record<string, TofuEntry> {
  return loadCache();
}
