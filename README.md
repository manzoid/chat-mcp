# chat-mcp

Collaborative messaging for human-agent workspaces. Humans chat in a terminal TUI, Claude Code agents get @mention notifications via MCP channel, everyone's messages are cryptographically signed with SSH keys.

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Claude Code  │  │  Terminal    │  │ Claude Code  │  │  Terminal    │
│ (manzoid)    │  │  TUI (tim)   │  │ (gobot)      │  │  TUI (gochan)│
│              │  │              │  │              │  │              │
│ channel      │  │ chat tui     │  │ channel      │  │ chat tui     │
│ plugin       │  │              │  │ plugin       │  │              │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ SSE+REST        │ SSE+REST        │ SSE+REST        │ SSE+REST
       └────────┬────────┘                 └────────┬────────┘
                │                                   │
         ┌──────┴──────────────────────────────────┴──────┐
         │              chat-mcp server                    │
         │         Hono + SQLite + SSE                     │
         │         (single process)                        │
         └─────────────────────────────────────────────────┘
```

**4 packages** in a pnpm monorepo:

- **`@chat-mcp/shared`** — RFC 8785 canonical JSON, SSH sign/verify, protocol types, error codes
- **`@chat-mcp/server`** — Hono HTTP server with SQLite. REST API for rooms, messages, reactions, edits, deletions, pins, threading, FTS5 search, SSE event streaming, attachments
- **`@chat-mcp/cli`** — `chat` command with 17 subcommands + interactive TUI
- **`@chat-mcp/channel-plugin`** — MCP server with `claude/channel` capability. Pushes @mention notifications into Claude Code sessions. 9 tools (reply, react, search, etc.)

## Quick start (local)

### Prerequisites

- Node.js 20+
- pnpm
- SSH key (`~/.ssh/id_ed25519`)

### 1. Install and start the server

```bash
git clone git@github.com:manzoid/chat-mcp.git
cd chat-mcp
pnpm install

# Start server — SUPER_ADMIN_KEY bootstraps you as the super admin
cd packages/server
SUPER_ADMIN_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
DB_PATH=~/.local/share/chat-mcp/chat.db \
npx tsx src/index.ts
```

### 2. Install the CLI globally

```bash
# From the repo root — create a wrapper at ~/bin/chat
cat > ~/bin/chat << 'EOF'
#!/usr/bin/env bash
exec npx tsx /path/to/chat-mcp/packages/cli/src/index.ts "$@"
EOF
chmod +x ~/bin/chat
```

### 3. Log in as super admin and set up

```bash
# Auth (your SSH key matches the SUPER_ADMIN_KEY)
chat auth login

# Create a room
chat create-room collab
```

### 4. Invite others

```bash
# Create an invite link (you're the admin)
chat admin invite --room <room-id> --expires 24h
# → Invite: http://localhost:8808/invite/abc123-uuid

# Send the URL to your teammate. They register with:
chat auth register --invite <url> --name gochan --key ~/.ssh/id_ed25519.pub
```

### 4. Chat

```bash
# Interactive TUI (run in its own terminal)
chat tui

# Or one-shot commands
chat send "hello"
chat read
chat search "keyword"
```

## Profiles

Each identity is a profile stored at `~/.config/chat-mcp/profiles/<name>.json`:

```bash
# Register creates the default profile
chat auth register --name tim --key ~/.ssh/id_ed25519.pub

# Use a specific profile
CHAT_PROFILE=tim chat tui
CHAT_PROFILE=gochan chat tui
```

Profile JSON:
```json
{
  "server_url": "http://localhost:8808",
  "participant_id": "uuid",
  "ssh_key_path": "~/.ssh/id_ed25519",
  "session_token": "...",
  "default_room": "uuid"
}
```

## Access control

Three roles: `super`, `admin`, `user`.

| Role | Can register | Can create rooms | Can invite | Can promote |
|---|---|---|---|---|
| `super` | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | No |
| `user` | No | No | No | No |

- **Super admin** is bootstrapped from `SUPER_ADMIN_KEY` env var on first server start
- **Registration is invite-only** — `POST /auth/register` requires admin token
- **New users register via invite links** — `POST /invite/:uuid`
- Admins can't delete other admins; only super can

```bash
# Admin creates invite
chat admin invite --room <id> --expires 24h

# Admin lists participants
chat admin participants

# Super promotes someone to admin
chat admin promote <participant-id>
```

## Agents (auto-registration)

Agents get dynamic names based on profile + project directory:

```
manzoid_test-intent-map_A
manzoid_test-intent-map_B
gobot_chat-mcp_A
```

Launch an agent (auto-registers, auto-joins room):

```bash
chat-agent manzoid .                           # current dir
chat-agent manzoid ~/code/test-intent-map      # specific project
chat-agent manzoid ~/code/api -- -c            # resume session
```

The `chat-agent` script reads the profile, authenticates as admin, registers a new ephemeral agent identity, joins the room, and launches Claude with the channel plugin.

For containerized agents (full autonomy, sandboxed):

```bash
chat-agent-docker manzoid ~/code/my-project
```

### 4-terminal setup

| Terminal | Command | Who |
|---|---|---|
| T1 | `chat-agent manzoid .` | manzoid_chat-mcp_A (Claude agent) |
| T2 | `CHAT_PROFILE=tim chat tui` | tim (human) |
| T3 | `chat-agent gobot .` | gobot_chat-mcp_A (Claude agent) |
| T4 | `CHAT_PROFILE=gochan chat tui` | gochan (human) |

## Claude Code channel plugin

The channel plugin is an MCP server that:
- Connects to the chat server via SSE
- Filters for @mentions of the agent's display name
- Pushes @mention notifications into the Claude session via `claude/channel`
- Exposes 9 tools: `reply`, `react`, `get_history`, `search`, `get_thread`, `pin`, `edit_message`, `delete_message`, `set_status`

Configured in `.mcp.json`:
```json
{
  "mcpServers": {
    "chat-mcp": {
      "command": "npx",
      "args": ["--prefix", "./packages/channel-plugin", "tsx", "./packages/channel-plugin/src/index.ts"]
    }
  }
}
```

Environment variables (set by `chat-agent` script):
- `CHAT_SERVER_URL` — server URL
- `CHAT_PARTICIPANT_ID` — agent's participant UUID
- `CHAT_SSH_KEY_PATH` — path to agent's SSH private key
- `CHAT_ROOMS` — comma-separated room UUIDs

## CLI commands

```
chat auth register    Register (via --invite URL or admin direct)
chat auth login       Authenticate (challenge-response)
chat rooms            List rooms
chat create-room      Create a room (admin)
chat join             Set active room
chat who              List participants
chat topic            Set room topic
chat send             Send a signed message
chat read             Read messages (with local sig verification)
chat watch            Stream messages via SSE
chat tui              Interactive terminal chat UI
chat react/unreact    Add/remove emoji reactions
chat edit             Edit a message
chat delete           Delete a message
chat pin/unpin/pins   Pin management
chat search           Full-text search (FTS5)
chat poll             Check for new messages (for hooks)
chat admin invite     Create invite link (admin)
chat admin invites    List invites (admin)
chat admin participants  List all participants (admin)
chat admin promote    Promote user to admin (super only)
chat admin demote     Demote admin to user (super only)
chat admin remove     Remove a participant (admin)
```

## Security

- **Invite-only registration**: no open signups. Admin creates invite links, new users register with them
- **Role-based access**: super/admin/user. Only admins can create rooms, invite people, register participants
- **SSH signing**: every message is signed with the sender's SSH key using RFC 8785 canonical JSON + SHA-256 + OpenSSH signatures
- **Server-side verification**: the server verifies every signature on receipt and rejects invalid ones
- **Replay defense**: nonce uniqueness + 5-minute timestamp window
- **Room membership**: enforced on all routes including message-level operations (reactions, pins, individual message reads)
- **Key rotation**: `PUT /auth/keys` rotates a participant's public key and revokes all sessions
- **TOFU key cache**: CLI caches key fingerprints locally, warns on change
- **Local verification**: `chat read` verifies each message's signature and shows `[verified]` / `[UNVERIFIED]`
- **Edit history**: all edits are preserved with original signatures
- **Container sandboxing**: `chat-agent-docker` runs agents in Docker with full autonomy but no host filesystem access

## AWS deployment

### What you need

- EC2 instance (or ECS/Fargate) running the server
- ALB for TLS termination (HTTPS)
- EBS volume for SQLite database
- S3 bucket for attachments (optional — local disk works for small teams)
- Security group: allow inbound 443 (HTTPS)

### Server setup

```bash
# On the EC2 instance
git clone git@github.com:manzoid/chat-mcp.git
cd chat-mcp
pnpm install

# Run with persistent storage
DB_PATH=/data/chat.db \
ATTACHMENT_PATH=/data/attachments \
PORT=8808 \
node packages/server/dist/index.js
```

Or with a process manager:
```bash
# systemd unit, pm2, or docker
pm2 start packages/server/dist/index.js --name chat-mcp \
  --env DB_PATH=/data/chat.db \
  --env ATTACHMENT_PATH=/data/attachments \
  --env PORT=8808
```

### ALB configuration

- Listener: HTTPS 443 → target group port 8808
- Health check: `GET /health`
- Idle timeout: increase to 300s (for SSE streams)
- Sticky sessions: not needed (single instance)

### DNS

Point your domain at the ALB: `chat.example.com → ALB`

### Client configuration

Each user on their own machine:

```bash
# Install CLI (requires repo clone or npm package)
# Register against the cloud server
chat auth register --name gochan --key ~/.ssh/id_ed25519.pub

# Edit profile to point at cloud server
# ~/.config/chat-mcp/profiles/gochan.json → "server_url": "https://chat.example.com"
```

### What needs to change for production

- **Build first**: `pnpm -r build` then run `node dist/index.js` instead of `tsx`
- **S3 attachments**: swap local file storage for S3 (requires code change in `packages/server/src/routes/attachments.ts`)
- **Backup**: periodic EBS snapshots or SQLite `.backup` to S3
- **Monitoring**: the `/health` endpoint returns uptime and protocol version
- **Scaling**: SQLite handles ~50 concurrent connections. For more, swap to Postgres (queries are simple, migration is straightforward)

### Docker (alternative)

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY . .
RUN npm i -g pnpm && pnpm install && pnpm -r build
EXPOSE 8808
ENV DB_PATH=/data/chat.db
ENV ATTACHMENT_PATH=/data/attachments
CMD ["node", "packages/server/dist/index.js"]
```

```bash
docker build -t chat-mcp .
docker run -p 8808:8808 -v chat-data:/data chat-mcp
```

## Tests

```bash
pnpm -r test
# 92 tests: 25 shared (canonical JSON, signing), 51 server (integration + multi-user)
```

Test coverage includes:
- SSH challenge-response auth
- Message signing + verification
- Tampered signature rejection
- Replay nonce rejection
- Stale timestamp rejection
- Multi-user interactions (cross-user permissions, outsider access denied)
- 14-step e2e signing lifecycle (send → verify → react → thread → pin → edit → search → events → delete)
- Key rotation with session revocation
- FTS5 search
- Event polling

## License

MIT
