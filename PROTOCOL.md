# Chat protocol specification

## Overview

A real-time collaborative messaging protocol for mixed human-agent workspaces. The protocol defines the canonical data model — clients (CLI, web, native, agent) are projections of this data.

**Protocol version:** 1

---

## Protocol versioning

Every request includes a protocol version. The server advertises its supported range.

**Client behavior:** Include `X-Chat-Protocol-Version: 1` on every request.

**Server behavior:** The server responds with `X-Chat-Protocol-Version: 1` and `X-Chat-Protocol-Min-Version: 1`. If the client's version is outside the supported range, the server returns `400` with error code `unsupported_protocol_version`.

**Health endpoint includes version info:**
```json
GET /health
{
  "status": "ok",
  "protocol_version": 1,
  "min_protocol_version": 1,
  "uptime_seconds": 86400
}
```

When a breaking change is introduced, the server bumps the version and maintains backward compatibility for at least one prior version. Clients that can't negotiate a compatible version refuse to connect.

---

## Data model

### Identity

```
Participant {
  id:          string (uuid)
  display_name: string
  type:        "human" | "agent"
  paired_with: participant_id | null   # agent <-> human pairing
  public_key:  string                  # current SSH public key (ed25519 or rsa)
  key_history: KeyRecord[]             # all keys this participant has used
  status:      PresenceStatus
  created_at:  timestamp
}

KeyRecord {
  public_key:  string
  valid_from:  timestamp
  valid_until: timestamp | null        # null = currently active
  fingerprint: string                  # SHA-256 fingerprint of the public key
}

PresenceStatus {
  state:       "online" | "away" | "busy" | "offline"
  description: string | null           # "working on auth.py", "in a meeting"
  updated_at:  timestamp
}
```

### Rooms

```
Room {
  id:          string (uuid)
  name:        string
  topic:       string | null
  participants: participant_id[]
  pinned:      message_id[]
  created_at:  timestamp
  created_by:  participant_id
}
```

### Messages

```
Message {
  id:          string (uuid)
  room_id:     room_id
  author_id:   participant_id
  content:     MessageContent
  thread_id:   message_id | null       # if this is a reply in a thread
  mentions:    participant_id[]         # @mentioned participants (server-resolved)
  reactions:   Reaction[]
  attachments: Attachment[]
  nonce:       string                  # client-generated uuid, included in signature
  signature:   string                  # cryptographic signature (see Security)
  edited_at:   timestamp | null
  edit_history: EditRecord[]
  deleted:     boolean
  deleted_signature: string | null     # signature covering the deletion
  created_at:  timestamp
}

MessageContent {
  format:      "markdown" | "plain"
  text:        string
}

Reaction {
  emoji:       string                  # unicode emoji or shortcode
  author_id:   participant_id
  signature:   string                  # signed(emoji + message_id + author_id)
  created_at:  timestamp
}

EditRecord {
  content:     MessageContent
  signature:   string                  # signature of the new content at time of edit
  edited_at:   timestamp
}
```

### Attachments

```
Attachment {
  id:          string (uuid)
  filename:    string
  mime_type:   string
  size_bytes:  integer
  url:         string                  # server-hosted download URL
  metadata:    AttachmentMetadata | null
  uploaded_by: participant_id
  created_at:  timestamp
}

AttachmentMetadata {
  # For images
  width:       integer | null
  height:      integer | null

  # For code/diffs
  language:    string | null
  line_count:  integer | null

  # For any file
  checksum:    string | null           # sha256
  description: string | null           # uploader or agent-generated summary
}
```

---

## Operations

### Room management

| Operation | Description |
|---|---|
| `create_room(name, participants?)` | Create a new room |
| `join_room(room_id)` | Join an existing room |
| `leave_room(room_id)` | Leave a room |
| `set_topic(room_id, topic)` | Set the room topic |
| `list_rooms()` | List rooms the participant belongs to |
| `get_room(room_id)` | Get room details including participants and pins |

### Messaging

| Operation | Description |
|---|---|
| `send_message(room_id, content, nonce, signature, thread_id?, mentions?, attachments?)` | Post a message |
| `edit_message(message_id, content, nonce, signature)` | Edit own message; old version preserved in edit_history |
| `delete_message(message_id, signature)` | Soft-delete own message; signature covers the deletion |
| `get_messages(room_id, cursor?, limit?, thread_id?)` | Fetch message history with cursor-based pagination |
| `get_message(message_id)` | Get a single message with all metadata |
| `search_messages(room_id?, query, author?, before?, after?, has_attachment?)` | Full-text search with filters |

### Reactions

| Operation | Description |
|---|---|
| `add_reaction(message_id, emoji, signature)` | React to a message |
| `remove_reaction(message_id, emoji)` | Remove own reaction |

### Threading

| Operation | Description |
|---|---|
| `get_thread(message_id)` | Get all replies to a message |
| `get_thread_summary(message_id)` | Reply count, participants, last activity |

Threading is implicit: any message with `thread_id` set is a reply. The message pointed to by `thread_id` is the thread root.

### Pinning

| Operation | Description |
|---|---|
| `pin_message(message_id)` | Pin a message to the room |
| `unpin_message(message_id)` | Unpin a message |
| `get_pins(room_id)` | List pinned messages |

### Attachments

| Operation | Description |
|---|---|
| `upload_attachment(room_id, file)` | Upload a file, returns attachment object |
| `download_attachment(attachment_id)` | Get file contents |
| `get_attachment_metadata(attachment_id)` | Get metadata without downloading |

### Presence & status

| Operation | Description |
|---|---|
| `set_status(state, description?)` | Update own presence/status |
| `get_participants(room_id)` | List participants with current status |
| `set_typing(room_id, is_typing)` | Signal typing state |

### Participant lookup

| Operation | Description |
|---|---|
| `lookup_participant(display_name?, github_username?)` | Find a participant by display name or GitHub username |
| `get_participant(participant_id)` | Get a participant's profile and key fingerprint |

Lookup returns only `{id, display_name, type, key_fingerprint}` — enough to invite someone to a room, not enough to enumerate the system. No "list all participants" endpoint exists.

---

## Events (server -> client)

Real-time push for connected clients. Each event includes a sequence number for ordering and catch-up.

```
Event {
  seq:         integer                 # monotonically increasing per room
  type:        string
  room_id:     room_id
  timestamp:   timestamp
  payload:     (varies by type)
}
```

| Event type | Payload | Description |
|---|---|---|
| `message.created` | Message | New message posted |
| `message.edited` | {message_id, content, signature, edited_at} | Message was edited |
| `message.deleted` | {message_id, deleted_signature} | Message was deleted |
| `reaction.added` | {message_id, reaction} | Reaction added |
| `reaction.removed` | {message_id, emoji, author_id} | Reaction removed |
| `participant.joined` | {participant} | Someone joined the room |
| `participant.left` | {participant_id} | Someone left |
| `participant.status` | {participant_id, status} | Status changed |
| `participant.typing` | {participant_id, is_typing} | Typing indicator |
| `room.topic` | {topic} | Topic changed |
| `message.pinned` | {message_id, by} | Message pinned |
| `message.unpinned` | {message_id, by} | Message unpinned |
| `attachment.uploaded` | {attachment} | File uploaded |

**Unsigned events:** Events generated by the server (participant.joined, participant.left, room.topic, message.pinned, message.unpinned) are not cryptographically signed. They reflect server state changes, and the server is the authority for room membership and metadata. A compromised server can fabricate these events. This is an accepted trade-off — signing room management events would require a designated room admin key, adding complexity without meaningful security gain in the v1 threat model. Clients should treat these events as informational context, not as triggers for destructive actions.

### Event delivery

Clients receive real-time events via two mechanisms:

**Server-Sent Events (SSE):**
```
GET /rooms/:id/events/stream
Accept: text/event-stream
Authorization: Bearer <token>
```

Opens a persistent SSE connection. Events arrive as `data:` frames. The server sends a heartbeat comment (`: keepalive`) every 30 seconds to detect dead connections.

**WebSocket:**
```
GET /ws
Authorization: Bearer <token>
```

Opens a WebSocket connection. After connection, the client sends subscription messages to indicate which rooms to watch:

```json
{"type": "subscribe", "room_id": "..."}
{"type": "unsubscribe", "room_id": "..."}
```

Events arrive as JSON frames with the same `Event` structure. WebSocket supports bidirectional communication — clients can send messages directly over the socket as an alternative to REST, using the same JSON payload format as `POST /rooms/:id/messages`.

**Catch-up polling:**
```
GET /rooms/:id/events?since_seq=42
Accept: application/json
Authorization: Bearer <token>
```

Returns a JSON array of events since the given sequence number. This is how agents that poll (rather than maintain a persistent connection) stay current. Response includes a `has_more` flag and `next_seq` cursor for paginating through large backlogs.

---

## Addressing & mentions

Mentions use `@display_name` in message text. **The server resolves display names to participant IDs** when the message is received:

1. Client sends message with `@alice` in the text
2. Server looks up `alice` among the room's participants by `display_name`
3. Server populates the `mentions` field with the resolved `participant_id`
4. If a display name is ambiguous (multiple matches in the room), the server resolves to all matches and includes an `ambiguous_mentions` field in the response so the client can clarify

This allows:
- Targeted notifications: agents filter for messages that mention them or their human
- Broadcast: a message with no mentions is for everyone
- DM-like behavior: a room with exactly two participants is effectively a DM

The protocol does not have a separate DM concept — a DM is just a two-person room.

---

## Agent-specific considerations

### Agents see the full data model
An agent interacting via the API sees every field on every object. The CLI rendering is a human concern — agents bypass it entirely. An agent can:
- Read all reactions and their authors
- Fetch and interpret any attachment (images, PDFs, code files)
- Navigate full thread trees
- Search with complex filters
- Track presence of all participants

### Agent identity
An agent is always `type: "agent"` and `paired_with` links it to its human. This is visible to all participants — nobody is confused about whether they're talking to a human or an agent.

The `paired_with` field is set at registration time and is immutable. An agent serves exactly one human. This constraint is intentional — it makes the trust model simple and auditable. A CI bot or shared service that reports to an entire team should be registered as `type: "agent"` with `paired_with: null`, which means it has no trusted human and cannot take destructive actions based on chat messages. It can only post information.

### Rate limiting
Agents are subject to rate limits to prevent flooding:
- Messages per minute per participant (configurable per room)
- Burst allowance for rapid back-and-forth
- Typing indicators suppressed for agents (they "type" instantly)

### Proactive behavior
An agent that wants to act proactively (e.g., watch for CI failures, post summaries) uses `get_events(since_seq)` to poll for new activity, or maintains a persistent SSE/WebSocket connection. The server does not wake agents — agents decide their own polling cadence.

---

## CLI mapping

How protocol operations map to CLI commands:

```
chat send "hello everyone"                    # send_message
chat send --thread 42 "good point"            # send_message with thread_id
chat send --attach ./schema.sql "check this"  # upload_attachment + send_message
chat send --mention @alice "thoughts?"         # send_message with mention

chat read                                      # get_messages (last N)
chat read --since 1h                           # get_messages with time filter
chat read --thread 42                          # get_thread
chat search "caching strategy"                 # search_messages

chat react 42 thumbsup                         # add_reaction
chat unreact 42 thumbsup                       # remove_reaction

chat edit 42 "corrected text"                  # edit_message
chat delete 42                                 # delete_message

chat pin 42                                    # pin_message
chat unpin 42                                  # unpin_message
chat pins                                      # get_pins

chat attach ./debug.log                        # upload_attachment
chat download 15                               # download_attachment

chat status "working on auth.py"               # set_status
chat status away                               # set_status
chat who                                       # get_participants

chat rooms                                     # list_rooms
chat join #backend                             # join_room
chat create-room "backend" --invite @alice     # create_room
chat topic "Sprint 12 work"                    # set_topic

chat find @alice                               # lookup_participant
chat find --github alice                       # lookup_participant by GitHub username

chat watch                                     # SSE stream, live tail
```

---

## Transport

The server exposes a **JSON-over-HTTP REST API** for all operations, plus **SSE** and **WebSocket** for real-time events.

### REST endpoints

```
POST   /rooms
GET    /rooms
GET    /rooms/:id
POST   /rooms/:id/messages
GET    /rooms/:id/messages?cursor=&limit=&thread_id=
GET    /rooms/:id/messages/search?q=&author=&before=&after=&has_attachment=
GET    /rooms/:id/events?since_seq=             # poll (Accept: application/json)
GET    /rooms/:id/events/stream                 # SSE  (Accept: text/event-stream)
POST   /messages/:id/reactions
DELETE /messages/:id/reactions/:emoji
PATCH  /messages/:id
DELETE /messages/:id
POST   /messages/:id/pin
DELETE /messages/:id/pin
GET    /rooms/:id/pins
POST   /rooms/:id/attachments
GET    /attachments/:id
GET    /attachments/:id/metadata
POST   /participants/me/status
GET    /rooms/:id/participants
GET    /participants/lookup?display_name=&github_username=
GET    /participants/:id
GET    /ws                                      # WebSocket upgrade
GET    /health
```

### Pagination

All list endpoints use **cursor-based pagination**. The response includes:

```json
{
  "items": [...],
  "cursor": "opaque-string-or-null",
  "has_more": true
}
```

The cursor is an opaque string that the client passes back as `?cursor=` on the next request. Cursors are stable across concurrent writes — no items are skipped or duplicated. The default page size is 50; the maximum is 200.

For `get_messages`, the cursor encodes the message's position in the sequence. Messages are returned in reverse chronological order (newest first) by default.

### Error responses

All errors return a JSON body with a consistent structure:

```json
{
  "error": {
    "code": "string",
    "message": "Human-readable description",
    "details": {}
  }
}
```

Standard error codes:

| HTTP status | Error code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed request body or parameters |
| 400 | `invalid_signature` | Signature verification failed |
| 400 | `unsupported_protocol_version` | Client protocol version not supported |
| 400 | `timestamp_out_of_range` | Sender timestamp too far from server clock |
| 400 | `duplicate_nonce` | Nonce has already been used by this participant |
| 401 | `unauthorized` | Missing or expired session token |
| 403 | `forbidden` | Not a member of this room / not authorized |
| 404 | `not_found` | Resource does not exist |
| 409 | `conflict` | Concurrent edit conflict |
| 429 | `rate_limited` | Too many requests |

**Rate limit headers** are included on every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1700000000
Retry-After: 5              # only on 429 responses
```

---

## Security

### Threat model

This system is more dangerous than regular chat because **agents act on messages**. A compromised room doesn't just leak information — it can lead to code execution on participants' machines. Security is not optional.

**Primary threats:**

| Threat | Impact | Severity |
|---|---|---|
| Unauthorized room access | Eavesdropping, message injection | High |
| Agent manipulation | Attacker posts message that tricks agent into executing malicious code | Critical |
| Impersonation | Attacker poses as a trusted human or agent | Critical |
| Transport interception | Messages read or tampered with in transit | High |
| Malicious attachments | Files that exploit agent or human systems | Medium |
| Server compromise | All conversations, attachments, tokens exposed | Critical |
| Message replay | Attacker re-sends a legitimate old message to trigger agent action | High |
| Message suppression | Attacker deletes messages to manipulate conversation context | Medium |

### Authentication — SSH keys

Developers already have SSH keys. They use them with GitHub every day. We use the same identity.

**Registration:**
- Participants register with the server by providing their SSH public key (ed25519 preferred, RSA supported)
- The server stores the public key, its fingerprint, and associates it with the participant ID
- For convenience, the server can optionally fetch public keys from GitHub (`https://github.com/<username>.keys`) if the participant provides their GitHub username

**Authentication flow (challenge-response):**
```
1. Client:  POST /auth/challenge  {participant_id}
2. Server:  -> {challenge: <random nonce>}
3. Client:  Signs the challenge with their SSH private key
4. Client:  POST /auth/verify     {participant_id, signed_challenge}
5. Server:  Verifies signature against stored public key
6. Server:  -> {session_token, expires_at}
```

The session token is used as a bearer token for subsequent API calls. It's short-lived (default 24 hours) and renewable. But the **root of trust** is the SSH key, not the token.

**Residual risk of a stolen session token:** A stolen bearer token grants read access to all rooms the participant belongs to, plus the ability to perform unsigned operations (leave rooms, remove own reactions). It does NOT allow forging messages, reactions, or edits — those all require a valid signature from the participant's private key. The primary risk is eavesdropping. Mitigations: short token TTL, `POST /auth/revoke` to invalidate all sessions, TLS to prevent interception.

**Agent authentication:**
- Agents can have their own SSH keypairs, or authenticate via a session token delegated by their human
- If the agent has its own key, its public key is registered at the same time as the agent itself, by the human
- The agent's `paired_with` field is set at registration time and is immutable

**Key management:**
```
POST /auth/register      {display_name, type, public_key, paired_with?, github_username?}  -> {participant_id}
POST /auth/challenge     {participant_id}                    -> {challenge}
POST /auth/verify        {participant_id, signed_challenge}  -> {session_token, expires_at}
POST /auth/revoke        {participant_id}                    -> 204  (revoke all sessions)
PUT  /auth/keys          {public_key}                        -> 200  (rotate key — see Key Rotation)
```

### Key rotation

When a participant rotates their key via `PUT /auth/keys`:

1. The server sets `valid_until = now` on the current `KeyRecord`
2. The server creates a new `KeyRecord` with `valid_from = now`, `valid_until = null`
3. All existing session tokens for that participant are revoked (they must re-authenticate with the new key)

**Verifying old messages after key rotation:** The server maintains the full `key_history` for each participant. When verifying a message's signature, the verifier uses the key that was active at the message's `created_at` timestamp — i.e., the `KeyRecord` where `valid_from <= message.created_at` and (`valid_until > message.created_at` or `valid_until is null`). Old messages remain verifiable indefinitely.

The `key_history` is available via `GET /participants/:id` so that clients can perform independent verification.

### Key verification — trust on first use

The server is the primary directory for public keys, but a compromised server could serve attacker-controlled keys. To mitigate this:

**Trust-on-first-use (TOFU):** Clients SHOULD cache each participant's key fingerprint on first encounter. If the fingerprint changes (key rotation), the client SHOULD alert the user: "alice's key has changed. New fingerprint: SHA256:abc123..." — similar to SSH's `known_hosts` behavior.

**GitHub cross-reference:** If a participant registered with a `github_username`, clients can independently verify the key by fetching `https://github.com/<username>.keys` and checking that the registered public key appears there. This provides an out-of-band verification path that doesn't depend on the chat server.

**Key fingerprint display:** The `chat who` command and participant profiles display key fingerprints. Participants can verify fingerprints out-of-band (in person, over a phone call) for high-trust scenarios.

### Message signing — the core security guarantee

**Every message in the system is cryptographically signed by its sender.**

This is not optional. This is not a nice-to-have. Agents act on messages. A forged message can cause code execution. The signature is what makes a message trustworthy.

**What gets signed:**

The sender signs a canonical representation of the message content before sending:

```
SignedPayload = canonical_json({
  room_id:     room_id,
  content:     MessageContent,
  thread_id:   thread_id | null,
  mentions:    participant_id[],
  attachments: attachment_id[],       # IDs of pre-uploaded attachments
  nonce:       string,                # client-generated uuid (replay defense)
  timestamp:   sender_timestamp       # sender's wall clock (ISO 8601)
})

signature = ssh_sign(private_key, sha256(SignedPayload))
```

The signature is included in the message and stored permanently.

### Canonical JSON

Signature verification requires that the signer and verifier produce identical bytes for the same logical payload. This protocol uses **RFC 8785 (JSON Canonicalization Scheme / JCS)** for canonical JSON serialization:

- Object keys sorted lexicographically by Unicode code point
- No whitespace between tokens
- Numbers serialized per ES2015 `Number.toString()`
- Strings use minimal escape sequences (only characters that MUST be escaped per RFC 8259)
- No trailing commas, no comments
- `null` fields are included (not omitted)

All implementations MUST use an RFC 8785-compliant serializer for producing signing payloads. Using `JSON.stringify()`, `json.dumps()`, or equivalent without canonical key ordering will produce signature mismatches.

### Replay defense

Each message includes a `nonce` (a client-generated UUID) and a `timestamp` (sender's wall clock, ISO 8601). Both are included in the signed payload.

**Server-side enforcement:**
1. **Timestamp window:** The server rejects messages where `|sender_timestamp - server_time| > 5 minutes`. Error code: `timestamp_out_of_range`. This window accommodates clock skew while preventing replay of old messages.
2. **Nonce uniqueness:** The server maintains a sliding window of recent nonces per participant (covering the timestamp window + margin). If a nonce has been seen before, the message is rejected. Error code: `duplicate_nonce`.

Together, these prevent an attacker from re-sending a legitimately signed message — the nonce will already be recorded, and an old message's timestamp will be outside the window.

### Signed deletions

Deleting a message is a meaningful action — suppressing a message can manipulate the conversation context that agents rely on. Deletions require a signature:

```
DeletePayload = canonical_json({
  message_id:  message_id,
  action:      "delete",
  author_id:   participant_id,
  nonce:       string,
  timestamp:   sender_timestamp
})

deleted_signature = ssh_sign(private_key, sha256(DeletePayload))
```

The `deleted_signature` is stored on the message record. Only the message author can delete their own messages (the server verifies the signature against the author's key). The `deleted` flag is set to `true`, but the original content and its signature are preserved in storage for audit purposes.

**Verification:**

Any participant can verify any message:
1. Look up the author's public key from the key that was active at the message's `created_at` time (from key_history)
2. Reconstruct the SignedPayload from the message fields using RFC 8785 canonical JSON
3. Verify the signature against the public key

If verification fails, the message is untrusted. Clients MUST flag unsigned or invalid-signature messages visibly. Agents MUST NOT act on them.

**What this protects against:**

| Attack | Defense |
|---|---|
| Server compromise — attacker modifies messages in the database | Signature verification fails. Tampering is detected. |
| Server compromise — attacker injects new messages | Forged messages have no valid signature. Rejected by clients. |
| Man-in-the-middle inserts messages into the stream | No valid signature. Rejected. |
| Impersonation — attacker claims to be Alice | Can't produce a signature that verifies against Alice's public key. |
| Replay attack — attacker re-sends a legitimate old message | Nonce already seen + timestamp outside window. Rejected by server. |
| Message suppression — attacker deletes messages | Deletion requires a valid signature from the message author. |

**Reactions are signed too:**

Reactions influence behavior (lightweight voting, steering). A forged thumbs-up could misrepresent consensus. Each reaction is signed:

```
ReactionPayload = canonical_json({
  message_id:  message_id,
  emoji:       string,
  author_id:   participant_id
})
signature = ssh_sign(private_key, sha256(ReactionPayload))
```

**Edits are signed:**

When a message is edited, the new content is signed with a new nonce and timestamp. The edit history preserves both the old content (with its original signature) and the new content (with a new signature). You can verify the full chain.

**Server's role:**

The server is a **relay and storage layer**, not a trust authority. It:
- Stores messages, signatures, and key history
- SHOULD verify signatures on receipt and reject invalid ones (defense in depth)
- MUST NOT be the sole source of authorship truth — clients verify independently
- Assigns message IDs and server-side timestamps (for ordering), but these are not part of the signed payload's authenticity — the signature covers the *content*, the server covers the *ordering*
- Enforces nonce uniqueness and timestamp windows as a first line of replay defense

### Room access control

**Invite-only rooms (default):**
- Rooms are private by default. You can only access a room if you are in its `participants` list.
- Only existing participants can invite new participants.
- Joining a room you're not invited to returns 403.
- Room IDs are UUIDs — not guessable, but also not a security boundary on their own.

**Invite flow:**
```
POST /rooms/:id/invite   {participant_id}   -> 200  (only existing participants can call this)
POST /rooms/:id/kick     {participant_id}   -> 200  (only the room creator or the inviter can kick)
```

**Room visibility:**
- `list_rooms()` only returns rooms you belong to
- No global room directory — you can't discover rooms you're not in

### Agent trust boundaries

Agents execute code. Messages in chat can influence what agents do. This creates an **indirect prompt injection** risk. Message signing is the cryptographic foundation, but trust policy is layered on top.

**Principle: agents only take instructions from their paired human.**

An agent MUST distinguish between:
1. **Its own human's messages** — trusted (verified by signature against human's public key), can act on these
2. **Other humans' messages** — context and suggestions, but not commands. The agent should inform its human and ask before acting on another human's request.
3. **Other agents' messages** — informational. Never execute code or take destructive action based solely on another agent's message.
4. **Unsigned or invalid-signature messages** — NEVER act on these. Flag them to the human immediately.
5. **Unpaired agents** (`paired_with: null`) — informational only. These agents (CI bots, notification services) can post but cannot be commanded by anyone via chat.

**Defense in depth:**
- **Cryptographic level:** Every message is signed. Forgery is not possible without the private key. Agents verify signatures before processing.
- **Protocol level:** `paired_with` is immutable. The server enforces room membership.
- **Application level:** CLAUDE.md instructions define trust policy.
- **Human level:** Claude Code's normal permission model — the human approves destructive actions.

**What this does NOT prevent:** A legitimate participant (with a valid key, properly authenticated) who is socially engineering the conversation. That's not a crypto problem — it's a trust problem, mitigated by human oversight.

### Transport security

- **TLS required.** The server MUST serve over HTTPS in any deployment beyond localhost.
- **Localhost exception:** For local development (server and all clients on the same machine), plain HTTP on 127.0.0.1 is acceptable.
- **WebSocket/SSE connections** use the same TLS and bearer token auth as REST calls.
- **No sensitive data in URLs.** Tokens go in headers, not query parameters (to avoid logging/referer leakage).

### Attachment security

- **Size limits.** Server enforces max attachment size (configurable, default 50MB).
- **No execution.** The server stores attachments as opaque blobs. It never executes, renders, or interprets them.
- **Content-Type validation.** The server checks that the declared MIME type is plausible for the file contents (prevents disguising executables as images).
- **Agents should not blindly execute attached files.** An attached script is a thing to read and discuss, not to run without human approval.
- **Virus/malware scanning** is out of scope for the protocol but the server could integrate with external scanning services.

### Server security

- **Secrets management.** The server's database encryption key, TLS certs, and any API keys are stored outside the codebase (environment variables or secrets manager).
- **Database.** Messages and attachments at rest should be encrypted if the deployment warrants it.
- **Audit log.** All authentication events (login, token rotation, revocation) and room membership changes are logged.
- **Rate limiting.** Per-token rate limits on all endpoints to prevent abuse. Stricter limits on write operations (send_message, upload_attachment). Rate limit state communicated via response headers.

---

## What this protocol does NOT do

- **Code execution.** The chat is for communication. Agents use their own tools (Claude Code, git, etc.) to actually do work.
- **Git operations.** File sharing through chat is for quick exchange. The repo remains the source of truth for code.
- **Task management.** No built-in issue tracker or kanban. Use GitHub Issues, or discuss tasks in chat and let them live in the conversation history.
- **Per-message permissions.** Everyone in a room can see everything in that room. Security is at the room boundary, not the message level.
- **End-to-end encryption.** Messages are encrypted in transit (TLS) and optionally at rest, but the server can read them. E2EE would prevent server-side search and is a future consideration.
