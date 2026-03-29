#!/usr/bin/env npx tsx
// Helper script for bash: authenticate a participant via challenge-response.
// Usage: npx tsx auth-helper.ts <server_url> <participant_id> <ssh_key_path>
// Outputs the session token on stdout.

import { sign } from "../src/signing.js";

const [serverUrl, participantId, keyPath] = process.argv.slice(2);

async function main() {
  const chalRes = await fetch(`${serverUrl}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participantId }),
  });
  const { challenge } = await chalRes.json();

  const sig = await sign(keyPath, { challenge });

  const verRes = await fetch(`${serverUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_id: participantId, signed_challenge: sig }),
  });
  const { session_token } = await verRes.json();

  if (!session_token) {
    process.exit(1);
  }
  process.stdout.write(session_token);
}

main().catch(() => process.exit(1));
