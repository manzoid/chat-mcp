import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getConfigDir } from "./config.js";
import { join } from "node:path";

const KNOWN_KEYS_FILE = join(getConfigDir(), "known_keys");

interface KnownKeys {
  [participantId: string]: string; // fingerprint
}

function load(): KnownKeys {
  if (!existsSync(KNOWN_KEYS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(KNOWN_KEYS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save(keys: KnownKeys): void {
  mkdirSync(getConfigDir(), { recursive: true });
  writeFileSync(KNOWN_KEYS_FILE, JSON.stringify(keys, null, 2) + "\n");
}

export type KeyCheckResult = "new" | "match" | "changed";

/**
 * Check a participant's key fingerprint against the local cache.
 * Returns "new" if never seen, "match" if fingerprint matches, "changed" if different.
 * Automatically caches new keys.
 */
export function checkKey(participantId: string, fingerprint: string): KeyCheckResult {
  const keys = load();

  if (!(participantId in keys)) {
    keys[participantId] = fingerprint;
    save(keys);
    return "new";
  }

  if (keys[participantId] === fingerprint) {
    return "match";
  }

  return "changed";
}

/**
 * Update a cached key fingerprint (after user confirms a key change is expected).
 */
export function acceptKeyChange(participantId: string, fingerprint: string): void {
  const keys = load();
  keys[participantId] = fingerprint;
  save(keys);
}
