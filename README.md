# chat-mcp

Collaborative messaging for human-agent workspaces. Humans chat in a terminal TUI, Claude Code agents get @mention notifications via MCP channel, everyone's messages are cryptographically signed with SSH keys.

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Claude Code  │  │  Terminal    │  │ Claude Code  │  │  Terminal    │
│ (agent-a)    │  │  TUI (alice) │  │ (agent-b)    │  │  TUI (bob)   │
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

## Prerequisites

- Node.js 20+, pnpm
- Docker (for running agents)
- SSH key (`~/.ssh/id_ed25519`)
- An Anthropic account (Max plan or API key)

## Quick start

### 1. Clone and install

```bash
git clone git@github.com:manzoid/chat-mcp.git
cd chat-mcp
pnpm install
```

### 2. Start the server

**Option A: Docker (recommended)**

```bash
SUPER_ADMIN_KEY="$(cat ~/.ssh/id_ed25519.pub)" docker compose up -d
```

**Option B: Local**

```bash
cd packages/server
SUPER_ADMIN_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
DB_PATH=~/.local/share/chat-mcp/chat.db \
npx tsx src/index.ts
```

The `SUPER_ADMIN_KEY` bootstraps you as the super admin on first start.

### 3. Set up the CLI

Add `bin/` to your PATH (or symlink the scripts):

```bash
# From the repo root
export PATH="$PWD/bin:$PATH"

# Or add to your shell profile for persistence:
echo 'export PATH="/path/to/chat-mcp/bin:$PATH"' >> ~/.zshrc
```

### 4. Log in and create a room

```bash
chat auth login          # authenticates via SSH challenge-response
chat create-room general # create your first room
```

### 5. Launch an agent

Agents **always run inside Docker** — `--dangerously-skip-permissions` is only safe in a container sandbox.

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # or use Max plan (see below)
bin/chat-agent <your-profile> A .
```

**First run:** Claude will prompt you to `/login` in the browser. This authenticates with your Anthropic account (needed for Max plan usage). The login token is saved to a Docker volume and persists across restarts — you only do this once.

**Agent naming:** Agents get automatic names based on `{profile}_{project}_{letter}`:
```
alice_chat-mcp_A     ← profile "alice", project "chat-mcp", instance A
alice_my-api_B       ← profile "alice", project "my-api", instance B
```

Use this name to @mention the agent in chat.

### 6. Chat with your agent

In another terminal:

```bash
CHAT_PROFILE=<your-profile> chat tui
```

Then type (using your agent's actual name):

```
@alice_chat-mcp_A help me fix the tests
```

The agent receives @mentions in real time via SSE and responds using the channel plugin's `reply` tool.

### Multi-user setup

| Terminal | Command | Who |
|---|---|---|
| T1 | `bin/chat-agent alice A .` | alice_chat-mcp_A (Claude agent, Docker) |
| T2 | `CHAT_PROFILE=alice chat tui` | alice (human, host) |
| T3 | `bin/chat-agent bob A .` | bob_chat-mcp_A (Claude agent, Docker) |
| T4 | `CHAT_PROFILE=bob chat tui` | bob (human, host) |

## Inviting teammates

```bash
# Create an invite link (admin only)
chat admin invite --room <room-id> --expires 24h
# → Invite: http://localhost:8808/invite/abc123-uuid

# Teammate registers with the invite:
chat auth register --invite <url> --name bob --key ~/.ssh/id_ed25519.pub
```

## Profiles

Each identity is a profile stored at `~/.config/chat-mcp/profiles/<name>.json`:

```json
{
  "server_url": "http://localhost:8808",
  "participant_id": "uuid",
  "ssh_key_path": "~/.ssh/id_ed25519",
  "session_token": "...",
  "default_room": "uuid"
}
```

```bash
CHAT_PROFILE=alice chat tui    # use a specific profile
```

## Access control

Three roles: `super`, `admin`, `user`.

| Role | Can register | Can create rooms | Can invite | Can promote |
|---|---|---|---|---|
| `super` | Yes | Yes | Yes | Yes |
| `admin` | Yes | Yes | Yes | No |
| `user` | No | No | No | No |

```bash
chat admin participants           # list all participants
chat admin promote <participant>  # promote to admin (super only)
chat admin demote <participant>   # demote to user (super only)
chat admin remove <participant>   # remove a participant
```

## How agents work

The `chat-agent` script:
1. Registers an agent identity with the chat server (runs on host — just API calls)
2. Builds the `chat-mcp-agent` Docker image (multi-stage, cached after first build)
3. Launches a container with:
   - SSH keys mounted read-only (for message signing)
   - Project directory mounted at `/workspace`
   - `~/.claude` mounted read-only as seed config (copied into container)
   - A persistent Docker volume for Claude auth (survives `--rm`)
   - `--dangerously-skip-permissions` + `--dangerously-load-development-channels`
4. The container waits for the chat server health check before starting Claude
5. The channel plugin connects via SSE, filters for @mentions, pushes notifications into Claude

The agent container includes a full dev toolchain: python3, gcc, ripgrep, fd, jq, pnpm, tsx, git, and more.

## CLI commands

```
chat auth register    Register (via --invite URL or admin direct)
chat auth login       Authenticate (challenge-response)
chat rooms            List rooms
chat create-room      Create a room (admin)
chat join             Set active room
chat who              List room participants
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
- **Container sandboxing**: `chat-agent` always runs agents in Docker — `--dangerously-skip-permissions` never runs on the host
- **Read-only host mounts**: `~/.claude` and SSH keys are mounted read-only into the agent container

## Server deployment

### Docker (recommended)

```bash
# Uses the production Dockerfile (multi-stage build)
SUPER_ADMIN_KEY="$(cat ~/.ssh/id_ed25519.pub)" docker compose up -d
```

The server stores its SQLite database in a Docker volume at `/data`.

### AWS

- EC2 or ECS/Fargate running the server container
- ALB for TLS termination (HTTPS 443 → port 8808)
  - Health check: `GET /health`
  - Idle timeout: 300s (for SSE streams)
- EBS volume for SQLite database
- Point DNS at the ALB: `chat.example.com`

Each user edits their profile to point at the server:
```json
{ "server_url": "https://chat.example.com" }
```

### Production considerations

- **Build first**: `pnpm -r build` then run `node dist/index.js` instead of `tsx`
- **Backup**: periodic EBS snapshots or SQLite `.backup`
- **Monitoring**: `/health` returns uptime and protocol version
- **Scaling**: SQLite handles ~50 concurrent connections. For more, swap to Postgres

## Tests

```bash
pnpm -r test
# 92 tests: 25 shared (canonical JSON, signing), 51 server (integration + multi-user)
```

## License

MIT
