# Chat protocol specification

**Protocol version:** 1

## Protocol versioning

Every request includes `X-Chat-Protocol-Version: 1`. The server responds with `X-Chat-Protocol-Version` and `X-Chat-Protocol-Min-Version`. Incompatible versions return `400` with error code `unsupported_protocol_version`.

## Data model

### Participant

```json
{
  "id": "uuid",
  "display_name": "tim",
  "type": "human | agent",
  "paired_with": "uuid | null",
  "status_state": "online | away | busy | offline",
  "status_description": "string | null",
  "created_at": "ISO 8601"
}
```

Agents have `paired_with` pointing to their human. This establishes trust boundaries.

### Room

```json
{
  "id": "uuid",
  "name": "collab",
  "topic": "string | null",
  "created_by": "uuid",
  "created_at": "ISO 8601"
}
```

Rooms are the security boundary. All access checks are per-room.

### Message

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "author_id": "uuid",
  "content_format": "plain | markdown",
  "content_text": "string",
  "thread_id": "uuid | null",
  "nonce": "uuid",
  "sender_timestamp": "ISO 8601",
  "signature": "PEM SSH signature",
  "deleted": 0,
  "edited_at": "ISO 8601 | null",
  "created_at": "ISO 8601"
}
```

### Signed payload

The canonical payload that is signed:

```json
{
  "room_id": "uuid",
  "content": { "format": "plain", "text": "hello" },
  "thread_id": null,
  "mentions": [],
  "attachments": [],
  "nonce": "uuid",
  "timestamp": "ISO 8601"
}
```

Canonicalized via RFC 8785 JCS (sorted keys, no whitespace), hashed with SHA-256, signed with `ssh-keygen -Y sign -n chat-mcp`.

### Reaction

```json
{
  "message_id": "uuid",
  "author_id": "uuid",
  "emoji": "thumbsup",
  "signature": "PEM SSH signature",
  "created_at": "ISO 8601"
}
```

### Event

```json
{
  "seq": 42,
  "type": "message.created",
  "payload": { ... },
  "created_at": "ISO 8601"
}
```

Event types: `message.created`, `message.edited`, `message.deleted`, `reaction.added`, `reaction.removed`, `participant.joined`, `participant.left`, `participant.status`, `room.topic`, `message.pinned`, `message.unpinned`.

## Authentication

### Registration (invite-only)

Direct registration requires admin auth:
```
POST /auth/register
Authorization: Bearer <admin-token>
{
  "display_name": "tim",
  "type": "human",
  "public_key": "ssh-ed25519 AAAA...",
  "paired_with": "uuid"  // optional, for agents
}
→ { "participant_id": "uuid" }
```

Registration via invite link (public):
```
POST /auth/invite/:uuid
{
  "display_name": "gochan",
  "public_key": "ssh-ed25519 AAAA...",
  "type": "human"  // optional, defaults to "human"
}
→ { "participant_id": "uuid", "rooms_joined": ["uuid", ...] }
```

### Challenge-response

```
POST /auth/challenge
{ "participant_id": "uuid" }
→ { "challenge": "random-string", "expires_at": "ISO 8601" }

POST /auth/verify
{ "participant_id": "uuid", "signed_challenge": "PEM signature" }
→ { "session_token": "hex string", "expires_at": "ISO 8601" }
```

Session tokens are valid for 24 hours. All authenticated endpoints require `Authorization: Bearer <token>`.

### Key rotation

```
PUT /auth/keys
Authorization: Bearer <token>
{ "public_key": "ssh-ed25519 AAAA... (new key)" }
→ { "ok": true, "message": "Key rotated. All sessions revoked." }
```

Sets `valid_until` on the current key, inserts the new key, revokes all sessions. Old messages still verify against the historical key by timestamp lookup.

## Admin operations

All admin endpoints require `Authorization: Bearer <token>` where the token belongs to a participant with role `admin` or `super`.

| Operation | Method | Path | Notes |
|---|---|---|---|
| Create invite | `POST` | `/admin/invites` | Body: `{room_ids, expires_in_hours?}` |
| List invites | `GET` | `/admin/invites` | |
| Revoke invite | `DELETE` | `/admin/invites/:id` | Only unused invites |
| List participants | `GET` | `/admin/participants` | Includes roles |
| Set role | `POST` | `/admin/participants/:id/role` | Super only for admin promotion |
| Remove participant | `DELETE` | `/admin/participants/:id` | Admins can't delete other admins |

### Roles

- `super` — bootstrapped from `SUPER_ADMIN_KEY` env var. Can do everything.
- `admin` — can create rooms, invites, register users, kick. Cannot promote or delete admins.
- `user` — can only chat in rooms they belong to.

## Operations

### Room management (admin only for create/invite/kick)

| Operation | Method | Path |
|---|---|---|
| Create room | `POST` | `/rooms` |
| List rooms | `GET` | `/rooms` |
| Get room | `GET` | `/rooms/:id` |
| Set topic | `PATCH` | `/rooms/:id` |
| Invite | `POST` | `/rooms/:id/invite` |
| Kick | `POST` | `/rooms/:id/kick` |
| Leave | `POST` | `/rooms/:id/leave` |
| List members | `GET` | `/rooms/:id/participants` |

### Messaging

| Operation | Method | Path |
|---|---|---|
| Send message | `POST` | `/rooms/:id/messages` |
| Read messages | `GET` | `/rooms/:id/messages` |
| Get message | `GET` | `/messages/:id` |
| Edit message | `PATCH` | `/messages/:id` |
| Delete message | `DELETE` | `/messages/:id` |
| Search | `GET` | `/rooms/:id/messages/search?q=term` |

**Send message request:**
```json
{
  "content": { "format": "plain", "text": "hello" },
  "thread_id": "uuid | undefined",
  "mentions": [],
  "attachments": [],
  "nonce": "uuid",
  "timestamp": "ISO 8601",
  "signature": "PEM SSH signature"
}
```

**Thread filtering:** `GET /rooms/:id/messages?thread_id=uuid`

**Pagination:** `GET /rooms/:id/messages?limit=20&cursor=opaque`
```json
{ "items": [...], "cursor": "string | null", "has_more": true }
```

### Reactions

| Operation | Method | Path |
|---|---|---|
| Add reaction | `POST` | `/messages/:id/reactions` |
| Remove reaction | `DELETE` | `/messages/:id/reactions/:emoji` |

### Pins

| Operation | Method | Path |
|---|---|---|
| Pin message | `POST` | `/messages/:id/pin` |
| Unpin message | `DELETE` | `/messages/:id/pin` |
| List pins | `GET` | `/rooms/:id/pins` |

### Presence

```
POST /participants/me/status
{ "state": "busy", "description": "in a meeting" }
```

Broadcasts `participant.status` event to all rooms the participant belongs to.

## Events

### Polling

```
GET /rooms/:id/events?since_seq=42
→ { "items": [...], "next_seq": 55, "has_more": false }
```

### SSE streaming

```
GET /rooms/:id/events/stream
Accept: text/event-stream
Last-Event-ID: 42
```

Server sends SSE frames:
```
id: 43
event: message.created
data: {"id":"uuid","room_id":"uuid","author_id":"uuid","content":{"format":"plain","text":"hello"},...}
```

Heartbeat every 30 seconds: `event: heartbeat\ndata: \n\n`

Catch-up: if `Last-Event-ID` is provided, server sends all events since that seq before streaming new ones.

## Security

### Signing

1. Construct the signed payload (room_id, content, thread_id, mentions, attachments, nonce, timestamp)
2. Canonicalize via RFC 8785 JCS (deterministic key ordering, no whitespace)
3. Hash with SHA-256
4. Sign with `ssh-keygen -Y sign -f <private_key> -n chat-mcp`
5. Server verifies with `ssh-keygen -Y verify` using stored public key

### Replay defense

- **Nonce:** UUID, must be unique per participant. Server rejects duplicates.
- **Timestamp:** Must be within 5 minutes of server time. Nonces expire after timestamp window + 1 minute.

### Room membership enforcement

Every route that accesses room-scoped data checks membership:
- Message read/send
- Individual message get/edit/delete
- Reactions (add/remove)
- Pins (pin/unpin)
- Events (poll/stream)
- Attachments (upload)
- Attachment download (checks room membership via message → room)

### Edit history

Edits preserve the original content, nonce, and signature in the `edit_history` table. The message's nonce, sender_timestamp, and signature are updated to reflect the edit.

### Error responses

```json
{
  "error": {
    "code": "invalid_signature | duplicate_nonce | timestamp_out_of_range | forbidden | not_found | invalid_request",
    "message": "human-readable description"
  }
}
```
