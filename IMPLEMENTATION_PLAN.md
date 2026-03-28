# Implementation Plan

## Technology Decision: TypeScript/Bun for Everything

The design docs say "Python or Node." The plan recommends **TypeScript on Bun** for all four components. Rationale:
- The channel plugin must be TypeScript/Bun (MCP SDK requirement)
- Using the same runtime everywhere means shared code: canonical JSON, signing, protocol types — written once, used by server, CLI, and plugin
- Bun has native SQLite (`bun:sqlite`), native SSE, native WebSocket
- Two languages (Python server + TypeScript plugin) means duplicating security-critical signing code and risking byte-level mismatches that break signatures

## Build Order

```
Phase 1: Foundation (shared types, canonical JSON, SSH signing, SQLite schema)
    |
Phase 2: Chat server core REST API (no auth yet)
    |
Phase 3: SSH auth + message signing (the hard crypto layer)
    |
Phase 4: CLI client (one-shot commands first, TUI later)
    |
Phase 5: Real-time (SSE + WebSocket)
    |
Phase 6: Channel plugin (MCP server bridging Claude Code to chat)
    |
Phase 7: Integration testing + hardening
```

## Project Structure

```
chat-mcp/
  packages/
    shared/              # Types, canonical JSON, SSH signing, constants
    server/              # Chat server (Bun + Hono + SQLite)
    cli/                 # CLI client (commander)
    channel-plugin/      # MCP server for Claude Code
  bun.workspace.ts
```

## Phase Details

### Phase 1: Foundation — Shared Code and Database

**Step 1.1: Bun workspace setup**
- `bun.workspace.ts` with four packages
- Shared `tsconfig.base.json`

**Step 1.2: Shared type definitions** (`packages/shared/src/types.ts`)
- All protocol types from PROTOCOL.md: `Participant`, `KeyRecord`, `Room`, `Message`, `Reaction`, `Attachment`, `Event`, etc.
- API request/response types for every endpoint
- Error codes and error response shapes

**Step 1.3: Canonical JSON** (`packages/shared/src/canonical-json.ts`)
- RFC 8785 (JCS) compliant via the `canonicalize` npm package
- Comprehensive test vectors from the RFC
- This is the single most critical shared function — if it produces different bytes anywhere, signatures break

**Step 1.4: SSH signing utilities** (`packages/shared/src/ssh-signing.ts`)
- `signPayload(privateKeyPath, data)` — calls `ssh-keygen -Y sign`
- `verifySignature(publicKey, signature, data)` — calls `ssh-keygen -Y verify`
- `getKeyFingerprint(publicKey)` — SHA-256 fingerprint
- `fetchGitHubKeys(username)` — fetches from `https://github/<username>.keys`
- Unit tests with temp keypairs

**Step 1.5: SQLite schema** (`packages/server/src/db/schema.sql`)
- Tables: `participants`, `key_history`, `rooms`, `room_members`, `messages`, `messages_fts` (FTS5), `reactions`, `attachments`, `pins`, `edit_history`, `events`, `nonces`, `sessions`
- Indexes on hot paths

**Step 1.6: Database access layer** (`packages/server/src/db/`)
- Repository classes: `ParticipantRepo`, `RoomRepo`, `MessageRepo`, etc.
- WAL mode enabled on open

### Phase 2: Chat Server — Core REST API (No Auth)

Auth stubbed — every request accepted with a hardcoded participant ID.

**Step 2.1:** HTTP framework (Hono on Bun) + config (TOML)
**Step 2.2:** Participant endpoints (register, lookup, status)
**Step 2.3:** Room endpoints (create, list, get, invite, kick, membership check)
**Step 2.4:** Message endpoints (create, read with cursor pagination, edit, delete, search via FTS5)
**Step 2.5:** Mention resolution (`@display_name` → participant IDs)
**Step 2.6:** Reaction endpoints
**Step 2.7:** Thread and pin endpoints
**Step 2.8:** Attachment endpoints (multipart upload, download, metadata)
**Step 2.9:** Event system (every mutation inserts into `events` table with room-scoped seq number)
**Step 2.10:** Error handling, rate limiting middleware, protocol version check
**Step 2.11:** Health endpoint

### Phase 3: SSH Auth + Message Signing

**Step 3.1:** Challenge-response auth endpoints (`/auth/challenge`, `/auth/verify`)
**Step 3.2:** Session middleware (bearer token extraction, expiry check, 401 on failure)
**Step 3.3:** Message signature verification on ingestion:
  1. Reconstruct `SignedPayload` from request body using canonical JSON
  2. SHA-256 hash
  3. Verify against author's public key
  4. Check timestamp window (±5 minutes)
  5. Check nonce uniqueness
  6. Same pattern for edits, deletions, reactions
**Step 3.4:** Key rotation endpoint
**Step 3.5:** Historical signature verification (key lookup by `created_at`)
**Step 3.6:** Sessions table (store token hash, not raw token)

### Phase 4: CLI Client

**Step 4.1:** CLI framework (commander) + config (`~/.config/chat-mcp/config.toml`)
**Step 4.2:** Auth commands (`chat register`, `chat login`, auto-login on expiry)
**Step 4.3:** All one-shot commands from PROTOCOL.md's CLI mapping:
  - `chat send`, `chat read`, `chat search`, `chat react`, `chat edit`, `chat delete`
  - `chat pin`, `chat pins`, `chat attach`, `chat download`
  - `chat status`, `chat who`, `chat find`, `chat rooms`, `chat join`, `chat topic`
  - `chat watch` (SSE live tail)
**Step 4.4:** Message signing (construct `SignedPayload`, sign with SSH key before sending)
**Step 4.5:** Local signature verification with TOFU key cache (`~/.config/chat-mcp/known_keys`)
**Step 4.6:** Interactive TUI mode (start simple: scrolling log + input + SSE, iterate later)

### Phase 5: Real-Time — SSE and WebSocket

**Step 5.1:** SSE endpoint (`GET /rooms/:id/events/stream`) with keepalive heartbeat
**Step 5.2:** WebSocket endpoint (`GET /ws`) with subscribe/unsubscribe per room
**Step 5.3:** Connection management (in-memory map of room → connections, cleanup on disconnect)

### Phase 6: Channel Plugin (MCP Server)

**Step 6.1:** MCP server scaffold using `@modelcontextprotocol/sdk`, stdio transport
**Step 6.2:** Chat server connection (auth, SSE/WebSocket subscription, reconnection with backoff)
**Step 6.3:** Event-to-channel bridge (verify signatures locally, format as `<channel>` notifications)
**Step 6.4:** MCP tools: `reply`, `react`, `send_attachment`, `edit_message`, `delete_message`, `set_status`, `get_history`, `search`, `pin`, `get_thread`
**Step 6.5:** Server instructions (trust policy injected into Claude's system prompt)
**Step 6.6:** Permission relay (if Claude Code supports `claude/channel/permission`)
**Step 6.7:** Fallback mode (tools work even if channel events don't push)

### Phase 7: Integration Testing + Hardening

**Step 7.1:** End-to-end scenario (two participants, full message lifecycle)
**Step 7.2:** Cross-component signature verification (CLI signs → server verifies → plugin verifies, and reverse)
**Step 7.3:** Reconnection and resilience (kill server, verify clients catch up)
**Step 7.4:** Rate limiting verification
**Step 7.5:** Graceful shutdown

## Incremental Milestones

| Milestone | What works | Target |
|---|---|---|
| 1: "Hello World" | Shared types, server with rooms/messages (no auth), CLI send/read | Week 1-2 |
| 2: "Signed and Authenticated" | SSH signing, challenge-response auth, signature verification | Week 2-3 |
| 3: "Full Protocol" | Reactions, threads, pins, edits, deletions, mentions, search, attachments | Week 3-4 |
| 4: "Real-Time" | SSE, WebSocket, `chat watch`, basic TUI | Week 4-5 |
| 5: "Agent Bridge" | Channel plugin with tools, event bridge, local verification | Week 5-6 |
| 6: "Production Ready" | Permission relay, rate limiting, TOFU cache, integration tests, docs | Week 6-7 |

## Hardest Parts and Risks

1. **Canonical JSON byte-level consistency** — if client and server produce different bytes for the same payload, every signature fails. Mitigation: single shared library, test vectors checked by all components.

2. **SSH signing via subprocess** — passphrase-protected keys will hang, different OpenSSH versions may behave differently. Mitigation: require passwordless keys for agents, use `ssh-agent` for humans.

3. **Claude Code channel API stability** — the channel features are in research preview. Mitigation: the `chat` CLI is the complete fallback; the channel plugin degrades to tool-only mode.

4. **SSE authentication** — `EventSource` API doesn't support custom headers. Mitigation: CLI and plugin use raw HTTP clients (not `EventSource`), so headers are fine.

5. **TUI complexity** — interactive terminal UIs are fiddly. Mitigation: build one-shot commands first, TUI is lowest priority.

6. **Concurrent SQLite writes** — WAL handles reads, but concurrent writes produce `SQLITE_BUSY`. Mitigation: single-process server, writes serialized by event loop.

## Shared Contracts (Must Be Identical Across Components)

1. `SignedPayload` structure — fields, order, null handling
2. Canonical JSON serialization — identical bytes everywhere
3. SSH signing parameters — namespace `chat-mcp`, hash `sha256`
4. API request/response types
5. Event payload shapes
6. Error codes

All defined once in `packages/shared/`, imported by all components.
