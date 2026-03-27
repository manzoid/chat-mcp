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

Authentication is via bearer token. Each participant (human or agent) gets a token when they register.

---

## What This Protocol Does NOT Do

- **Code execution.** The chat is for communication. Agents use their own tools (Claude Code, git, etc.) to actually do work.
- **Git operations.** File sharing through chat is for quick exchange. The repo remains the source of truth for code.
- **Task management.** No built-in issue tracker or kanban. Use GitHub Issues, or discuss tasks in chat and let them live in the conversation history.
- **Access control beyond rooms.** No per-message permissions, no admin roles (for now). Everyone in a room can see everything in that room.
