# Chat Protocol Specification

## Overview

A real-time collaborative messaging protocol for mixed human-agent workspaces. The protocol defines the canonical data model — clients (CLI, web, native, agent) are projections of this data.

---

## Data Model

### Identity

```
Participant {
  id:          string (uuid)
  display_name: string
  type:        "human" | "agent"
  paired_with: participant_id | null   # agent <-> human pairing
  public_key:  string                  # SSH public key (ed25519 or rsa)
  status:      PresenceStatus
  created_at:  timestamp
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
  mentions:    participant_id[]         # @mentioned participants
  reactions:   Reaction[]
  attachments: Attachment[]
  signature:   string                  # cryptographic signature (see Security)
  edited_at:   timestamp | null
  edit_history: EditRecord[]
  deleted:     boolean
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

### Room Management

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
| `send_message(room_id, content, thread_id?, mentions?, attachments?)` | Post a message |
| `edit_message(message_id, content)` | Edit own message; old version preserved in edit_history |
| `delete_message(message_id)` | Soft-delete own message |
| `get_messages(room_id, limit?, before?, after?, thread_id?)` | Fetch message history with pagination |
| `get_message(message_id)` | Get a single message with all metadata |
| `search_messages(room_id?, query, author?, before?, after?, has_attachment?)` | Full-text search with filters |

### Reactions

| Operation | Description |
|---|---|
| `add_reaction(message_id, emoji)` | React to a message |
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

### Presence & Status

| Operation | Description |
|---|---|
| `set_status(state, description?)` | Update own presence/status |
| `get_participants(room_id)` | List participants with current status |
| `set_typing(room_id, is_typing)` | Signal typing state |

---

## Events (Server -> Client)

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

| Event Type | Payload | Description |
|---|---|---|
| `message.created` | Message | New message posted |
| `message.edited` | {message_id, content, edited_at} | Message was edited |
| `message.deleted` | {message_id} | Message was deleted |
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

### Event Delivery

Clients connect via **Server-Sent Events (SSE)** or **WebSocket** for real-time delivery. Clients that disconnect can catch up by requesting events since a given sequence number:

```
get_events(room_id, since_seq) -> Event[]
```

This is how agents that poll (rather than maintain a persistent connection) stay current.

---

## Addressing & Mentions

Mentions use `@display_name` in message text and are resolved to participant IDs in the `mentions` field. This allows:
- Targeted notifications: agents filter for messages that mention them or their human
- Broadcast: a message with no mentions is for everyone
- DM-like behavior: a room with exactly two participants is effectively a DM

The protocol does not have a separate DM concept — a DM is just a two-person room.

---

## Agent-Specific Considerations

### Agents see the full data model
An agent interacting via the API sees every field on every object. The CLI rendering is a human concern — agents bypass it entirely. An agent can:
- Read all reactions and their authors
- Fetch and interpret any attachment (images, PDFs, code files)
- Navigate full thread trees
- Search with complex filters
- Track presence of all participants

### Agent identity
An agent is always `type: "agent"` and `paired_with` links it to its human. This is visible to all participants — nobody is confused about whether they're talking to a human or an agent.

### Rate limiting
Agents are subject to rate limits to prevent flooding:
- Messages per minute per participant (configurable per room)
- Burst allowance for rapid back-and-forth
- Typing indicators suppressed for agents (they "type" instantly)

### Proactive behavior
An agent that wants to act proactively (e.g., watch for CI failures, post summaries) uses `get_events(since_seq)` to poll for new activity, or maintains a persistent SSE/WebSocket connection. The server does not wake agents — agents decide their own polling cadence.

---

## CLI Mapping

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

chat react 42 👍                               # add_reaction
chat unreact 42 👍                             # remove_reaction

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

chat watch                                     # SSE stream, live tail
```

---

## Transport

The server exposes a **JSON-over-HTTP REST API** for all operations, plus **SSE** (or WebSocket) for real-time events.

```
POST   /rooms
GET    /rooms
GET    /rooms/:id
POST   /rooms/:id/messages
GET    /rooms/:id/messages?limit=&before=&after=&thread_id=
GET    /rooms/:id/messages/search?q=&author=&before=&after=
GET    /rooms/:id/events?since_seq=       # SSE stream or poll
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
```

---

## Security

### Threat Model

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

### Authentication — SSH Keys

Developers already have SSH keys. They use them with GitHub every day. We use the same identity.

**Registration:**
- Participants register with the server by providing their SSH public key (ed25519 preferred, RSA supported)
- The server stores the public key and associates it with the participant ID
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

The session token is used as a bearer token for subsequent API calls. It's short-lived and renewable. But the **root of trust** is the SSH key, not the token.

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
PUT  /auth/keys          {public_key}                        -> 200  (rotate key)
```

### Message Signing — The Core Security Guarantee

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
  timestamp:   sender_timestamp       # sender's wall clock
})

signature = ssh_sign(private_key, sha256(SignedPayload))
```

The signature is included in the message and stored permanently.

**Verification:**

Any participant can verify any message:
1. Look up the author's public key (from the participant record)
2. Reconstruct the SignedPayload from the message fields
3. Verify the signature against the public key

If verification fails, the message is untrusted. Clients MUST flag unsigned or invalid-signature messages visibly. Agents MUST NOT act on them.

**What this protects against:**

| Attack | Defense |
|---|---|
| Server compromise — attacker modifies messages in the database | Signature verification fails. Tampering is detected. |
| Server compromise — attacker injects new messages | Forged messages have no valid signature. Rejected by clients. |
| Man-in-the-middle inserts messages into the stream | No valid signature. Rejected. |
| Impersonation — attacker claims to be Alice | Can't produce a signature that verifies against Alice's public key. |
| Replay attack — attacker re-sends a legitimate old message | Detectable via timestamp and message ID (server assigns IDs). |

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

When a message is edited, the new content is signed. The edit history preserves both the old content (with its original signature) and the new content (with a new signature). You can verify the full chain.

**Server's role:**

The server is a **relay and storage layer**, not a trust authority. It:
- Stores messages and signatures
- SHOULD verify signatures on receipt and reject invalid ones (defense in depth)
- MUST NOT be the sole source of authorship truth — clients verify independently
- Assigns message IDs and server-side timestamps (for ordering), but these are not part of the signed payload's authenticity — the signature covers the *content*, the server covers the *ordering*

### Room Access Control

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

### Agent Trust Boundaries

Agents execute code. Messages in chat can influence what agents do. This creates an **indirect prompt injection** risk. Message signing is the cryptographic foundation, but trust policy is layered on top.

**Principle: agents only take instructions from their paired human.**

An agent MUST distinguish between:
1. **Its own human's messages** — trusted (verified by signature against human's public key), can act on these
2. **Other humans' messages** — context and suggestions, but not commands. The agent should inform its human and ask before acting on another human's request.
3. **Other agents' messages** — informational. Never execute code or take destructive action based solely on another agent's message.
4. **Unsigned or invalid-signature messages** — NEVER act on these. Flag them to the human immediately.

**Defense in depth:**
- **Cryptographic level:** Every message is signed. Forgery is not possible without the private key. Agents verify signatures before processing.
- **Protocol level:** `paired_with` is immutable. The server enforces room membership.
- **Application level:** CLAUDE.md instructions define trust policy.
- **Human level:** Claude Code's normal permission model — the human approves destructive actions.

**What this does NOT prevent:** A legitimate participant (with a valid key, properly authenticated) who is socially engineering the conversation. That's not a crypto problem — it's a trust problem, mitigated by human oversight.

### Transport Security

- **TLS required.** The server MUST serve over HTTPS in any deployment beyond localhost.
- **Localhost exception:** For local development (server and all clients on the same machine), plain HTTP on 127.0.0.1 is acceptable.
- **WebSocket/SSE connections** use the same TLS and bearer token auth as REST calls.
- **No sensitive data in URLs.** Tokens go in headers, not query parameters (to avoid logging/referer leakage).

### Attachment Security

- **Size limits.** Server enforces max attachment size (configurable, default 50MB).
- **No execution.** The server stores attachments as opaque blobs. It never executes, renders, or interprets them.
- **Content-Type validation.** The server checks that the declared MIME type is plausible for the file contents (prevents disguising executables as images).
- **Agents should not blindly execute attached files.** An attached script is a thing to read and discuss, not to run without human approval.
- **Virus/malware scanning** is out of scope for the protocol but the server could integrate with external scanning services.

### Server Security

- **Secrets management.** The server's database encryption key, TLS certs, and any API keys are stored outside the codebase (environment variables or secrets manager).
- **Database.** Messages and attachments at rest should be encrypted if the deployment warrants it.
- **Audit log.** All authentication events (login, token rotation, revocation) and room membership changes are logged.
- **Rate limiting.** Per-token rate limits on all endpoints to prevent abuse. Stricter limits on write operations (send_message, upload_attachment).

---

## What This Protocol Does NOT Do

- **Code execution.** The chat is for communication. Agents use their own tools (Claude Code, git, etc.) to actually do work.
- **Git operations.** File sharing through chat is for quick exchange. The repo remains the source of truth for code.
- **Task management.** No built-in issue tracker or kanban. Use GitHub Issues, or discuss tasks in chat and let them live in the conversation history.
- **Per-message permissions.** Everyone in a room can see everything in that room. Security is at the room boundary, not the message level.
- **End-to-end encryption.** Messages are encrypted in transit (TLS) and optionally at rest, but the server can read them. E2EE would prevent server-side search and is a future consideration.
