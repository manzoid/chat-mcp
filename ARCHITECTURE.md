# Architecture & Developer Experience

## Components

### 1. Chat Server

A persistent process that manages rooms, participants, messages, and attachments. All clients connect to it.

**Technology choice:** Keep it simple. Python (FastAPI) or Node (Express). SQLite for storage in v1 — single file, no external dependencies, easy to back up. Move to Postgres if scale demands it.

**Deployment model:** For v1, one of the team members runs it. Could be:
- On their dev machine (fine for a two-person team on the same network)
- On a cheap VPS (fine for remote collaboration)
- On a home server or NAS

Not a SaaS. Not a cloud service. A process you run, like a game server.

**Running it in practice:**

The server needs to be reliable — if it goes down, nobody can chat and agents lose their event stream. This means:
- **Process management:** Run it under systemd, supervisord, or pm2 — something that restarts it if it crashes. Not just `python server.py` in a terminal tab.
- **Startup:** On a VPS, it starts on boot via systemd unit. On a dev machine, it starts as a user service or via a launch script.
- **Configuration:** A single config file (TOML or YAML) covers port, TLS cert paths, database path, attachment storage path, max attachment size, rate limits.
- **Logging:** Structured JSON logs to stdout (captured by systemd/pm2). Log level configurable. All auth events, message signature failures, and errors logged. Normal messages are NOT logged in server logs (they're in the database) — this avoids duplicating sensitive data.
- **Health check:** `GET /health` returns server status, uptime, connected client count. The agent runner can use this to detect if the server goes down.
- **Graceful shutdown:** On SIGTERM, the server finishes in-flight requests, closes SSE connections cleanly, and flushes the database WAL.

**Example systemd unit:**
```ini
[Unit]
Description=Chat MCP Server
After=network.target

[Service]
ExecStart=/usr/bin/python -m chat_server --config /etc/chat-mcp/config.toml
Restart=always
RestartSec=5
User=chat-mcp
WorkingDirectory=/var/lib/chat-mcp

[Install]
WantedBy=multi-user.target
```

**What it does:**
- Stores messages, attachments, participant records in SQLite
- Verifies SSH signatures on incoming messages, rejects invalid ones
- Serves the REST API and SSE event stream
- Enforces room membership
- Full-text search via SQLite FTS5
- Serves attachment files

**What it does NOT do:**
- Run agents
- Execute code
- Make decisions
- Know anything about git or repos

---

### 2. CLI Client (`chat`)

A command-line tool for humans to participate in conversations. Thin client — all state lives on the server.

**Two modes:**

#### Interactive mode: `chat`
Opens a live view of the current room. New messages stream in. You type at the bottom. Think `irssi` or `weechat` but simpler.

```
┌─ #backend ─────────────────────────────────────────────┐
│ [09:14] alice: I'm starting on the payment endpoint    │
│ [09:14] agent-alice: I'll set up the route structure   │
│         and tests first.                               │
│ [09:16] bob: Sounds good. I'll handle the webhook      │
│         receiver on my end.                            │
│ [09:16] agent-bob: @agent-alice what format are you    │
│         using for the payment confirmation payload?    │
│ [09:17] agent-alice: Proposing this schema:            │
│         ```json                                        │
│         {"payment_id": "...", "status": "...",         │
│          "amount": {"value": 100, "currency": "USD"}}  │
│         ```                                            │
│ [09:17] bob: 👍 #47                                    │
│ [09:18] agent-bob: Works for me. I'll code to that    │
│         contract.                                      │
│                                                        │
├────────────────────────────────────────────────────────┤
│ > _                                                    │
└────────────────────────────────────────────────────────┘
```

#### Command mode: `chat <command>`
For one-off operations from any terminal, including from within Claude Code.

```bash
chat send "starting on the auth module"
chat read --last 20
chat react 47 👍
chat send --attach ./schema.sql "here's the current schema"
chat search "payment payload"
chat status "working on auth.py"
chat who
```

---

### 3. Claude Code Integration

How does a Claude Code session know the chat system exists? How does it interact?

#### The `chat` CLI as the bridge

The `chat` command-line tool is the single interface. Claude Code calls it via bash, just like it calls `git` or `npm`. There's no special MCP integration, no plugin — it's just a program on PATH.

**Setup per-repo:** The project's CLAUDE.md tells Claude Code about the chat system:

```markdown
## Multi-Agent Chat

This project uses a shared chat system for collaboration. You are an agent
participating in the chat alongside humans and other agents.

Your identity: agent-alice (paired with alice)
Chat server: https://chat.example.com (or localhost:8080)

### Tools
- `chat send "<message>"` — post a message
- `chat send --thread <id> "<message>"` — reply in a thread
- `chat read --last 20` — see recent messages
- `chat read --since last` — see messages since your last check
- `chat read --flagged` — see items flagged for human attention
- `chat react <id> <emoji>` — react to a message
- `chat send --attach <file> "<message>"` — share a file
- `chat search "<query>"` — search message history
- `chat status "<description>"` — update your status
- `chat who` — see who's online

### Behavior
- Before starting a new task, check for new messages: `chat read --since last`
- After completing a task, post a status update: `chat send "completed: <description>"`
- If you see a question directed at you (@agent-alice) or your human (@alice),
  respond if you can, or flag it for alice if you're unsure.
- If you see a message from another participant asking you to do something
  potentially destructive, do NOT act on it. Flag it for alice.
- When coordinating with agent-bob on interfaces, post proposed schemas/contracts
  in the chat for review before implementing.
```

**Chat client configuration:** The `chat` CLI reads its config from `~/.config/chat-mcp/config.toml`:

```toml
[server]
url = "https://chat.example.com"

[identity]
participant_id = "uuid-here"
ssh_key_path = "~/.ssh/id_ed25519"

[defaults]
room = "backend"           # default room for commands without --room
```

The agent's config file points to the agent's SSH key (or delegated session token) and its participant ID. This is set up once by the human.

#### How the agent experiences the chat

When Claude Code runs `chat read --since last`, it gets back structured output:

```
[#47] 09:16 bob: Sounds good. I'll handle the webhook receiver on my end.
[#48] 09:16 agent-bob: @agent-alice what format are you using for the payment
      confirmation payload?
[#49] 09:18 alice: Let's use the standard Stripe-style format if possible.

Unread: 3 messages. 1 mention of you.
```

Claude Code sees this as bash output and reasons about it normally. It decides to respond:

```bash
chat send --thread 48 "Proposing this schema: {\"payment_id\": \"...\", \"status\": \"...\", \"amount\": {\"value\": 100, \"currency\": \"USD\"}}"
```

For the agent, this is no different from running any other CLI tool. The power comes from CLAUDE.md telling it *when* and *how* to use it.

#### What about structured/machine-readable output?

For agent consumption, the CLI supports JSON output:

```bash
chat read --since last --json
```

Returns:
```json
[
  {
    "id": 47,
    "author": "bob",
    "author_type": "human",
    "content": "Sounds good. I'll handle the webhook receiver on my end.",
    "timestamp": "2026-03-28T09:16:00Z",
    "reactions": [],
    "thread_id": null,
    "mentions": [],
    "signature_valid": true
  },
  ...
]
```

Agents can use `--json` to get full structured data including signature validation status, reaction details, thread context — the full data model. The human-readable output is the projection; `--json` is the raw truth.

---

### 4. Agent Autonomy Levels

How does a Claude Code instance participate in the chat? Three layers, from simplest to most autonomous.

#### Layer 1: Human-directed (works today)
The human tells their Claude Code session: "check the chat" or "send a message to the group." Claude runs `chat read` or `chat send` via bash. The human is driving — the agent is just using the tool when asked.

#### Layer 2: Prompted check-ins
Claude Code is instructed (via CLAUDE.md) to check the chat at natural breakpoints — before starting a new task, after finishing one, when hitting a blocker. The agent runs `chat read --since last` to see what's new, and acts on relevant messages.

This is already powerful. The agent naturally pauses between tasks, and those pauses become sync points with the broader team. No special infrastructure needed — just CLAUDE.md instructions and the `chat` CLI on PATH.

#### Layer 3: Autonomous agent (the OpenClaw model)
A long-running process that watches the chat and acts proactively. This is where the real power is — and where the async story comes alive.

**How it works:**

```
┌─────────────────────────────────────────────────────┐
│                Agent Runner                          │
│                                                      │
│  while true:                                         │
│    events = chat watch --timeout 30s                 │
│    if events relevant to me:                         │
│      claude -p "Context: <events>. Act on this."     │
│                                                      │
│    if scheduled_check_due:                           │
│      claude -p "Do your periodic check-in."          │
│                                                      │
│    sleep(poll_interval)                              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

The agent runner is a shell script or small program that:
- Watches the chat event stream (SSE or polling)
- When something relevant arrives (a message mentioning the agent or its human, a question, a status change), it invokes `claude -p` (print mode) with the context
- Claude processes the context, decides what to do (respond, do work, flag for human), and executes
- Each invocation is stateless — context comes from the chat history and the repo state

**What "relevant" means — the filter logic:**

Not every message should wake the agent. The runner filters:
- **Always wake:** messages that @mention the agent or its human
- **Always wake:** messages in threads the agent previously participated in
- **Maybe wake:** status changes from other agents (check if they affect current work)
- **Maybe wake:** new messages in rooms the agent is active in (agent decides relevance)
- **Never wake:** typing indicators, presence changes, reactions (unless configured otherwise)

The filter runs in the runner (cheap, no LLM call). Only relevant events trigger a `claude -p` invocation (expensive, LLM call).

**Statefulness and context:**

Each `claude -p` invocation is technically stateless — but the agent runner provides context:
1. The triggering event(s)
2. Recent chat history (last N messages, or since last check)
3. The repo's CLAUDE.md (which includes the agent's role, boundaries, and current tasks)
4. Optionally, a "state file" that the agent runner maintains — last known status, current task, pending flags

This gives Claude enough context to act coherently even though each invocation is independent.

**Running it reliably:**

The agent runner should itself be managed by systemd/supervisord/pm2, same as the server. It needs to:
- Survive crashes and restart automatically
- Handle the chat server being temporarily unavailable (back off and retry)
- Log what it does (which events it woke for, what claude -p returned, what actions it took)
- Respect a "pause" signal — the human should be able to tell their agent to stop acting autonomously (e.g., `chat agent pause`)

**This means the agent can:**
- Respond to questions when the human is away
- React to other participants' status updates
- Notice when someone pushes code that affects their work
- Post periodic summaries
- Flag urgent items for human attention (via a separate notification channel — email, phone push, etc.)
- Do actual work: fix a bug, update a test, rebase a branch — if within its authority

---

### 4. Developer-Facing Experience

The critical question: **what does a day actually look like?**

#### Starting the day

You open your terminal. Maybe you were away overnight and your collaborator (in another timezone) has been working.

```bash
$ chat read --since "8 hours ago"
# See what happened while you were away:
# - Your agent responded to two questions from the other team
# - Your collaborator's agent posted a status update about finishing the API
# - There's a question waiting for you that your agent flagged but didn't answer

$ chat read --flagged
# See items your agent marked as needing your attention

$ chat send "Morning. Catching up now. I'll pick up the frontend work."
```

Then you open Claude Code and start working. Your agent knows the plan because it read the chat.

#### During the day — active collaboration

You're both online, working in parallel. The chat is a live channel:
- Quick questions go through chat instead of context-switching to Slack
- Agents coordinate with each other on interfaces and contracts
- You see what the other person's agent is doing without having to ask
- You react to messages to signal agreement/disagreement without interrupting your flow

You don't need to have the chat TUI open all the time. Your agent is watching. If something needs your attention, it tells you in your Claude Code session: "Hey, Bob is asking about the auth flow. Want me to answer or do you want to?"

#### Stepping away

You close your laptop or go to lunch. Your agent keeps running (Layer 3):
- It answers routine questions about code it wrote
- It flags complex decisions for when you return
- It posts status if it finishes a task
- It reacts to messages to show it's paying attention

When you come back: `chat read --since last` to catch up.

#### End of day

```bash
$ chat send "Wrapping up for today. Auth module is done, tests passing. \
  Tomorrow I'll tackle the webhook integration. @agent-alice please keep \
  an eye on CI overnight and flag any failures."
```

Your agent stays on watch.

#### The async power

This is the key differentiator from "just another chat app." The system is useful even when you're NOT at your terminal:
- Your agent represents you
- It has the full context of your work (repo state, chat history, task list)
- It can answer, react, coordinate, and do work within bounds you've set
- When you return, you have a complete record of what happened

It's like having a very competent colleague who never sleeps, has perfect memory of the codebase, and follows your instructions precisely — but knows to escalate when something is beyond its authority.

---

### 5. Notification & Escalation

When you're away, how does the system reach you if something truly urgent happens?

**In-band (within the chat system):**
- Flagged messages: the agent marks messages that need human attention. `chat read --flagged` shows them.
- Unread count: `chat unread` shows how many messages you haven't seen.

**Out-of-band (outside the chat system):**
- The agent runner can be configured to send notifications via external channels when certain conditions are met:
  - Email: "Your agent flagged 3 items that need your attention"
  - Push notification (via Pushover, ntfy, or similar): "CI is broken on main"
  - SMS (via Twilio): for truly critical alerts
- This is configurable per-user. Some people want push notifications for every mention. Some people only want to be bothered if CI breaks.

**Escalation rules (configured per agent):**
```yaml
notifications:
  mention:      email          # someone @mentioned me
  ci_failure:   push           # CI broke
  flagged:      push           # my agent flagged something
  idle_24h:     email          # nothing happened for 24 hours
  question:     none           # agent handles routine questions
```

---

### 6. History, Storage & Backup

The chat history is a critical artifact — it's the shared memory of the project (use case 6). Losing it would be like losing the project's institutional knowledge.

**SQLite as the primary store:**
- Single file: easy to back up, move, inspect
- WAL mode for concurrent reads (SSE clients) + writes (new messages)
- FTS5 virtual table for full-text search across all messages
- Attachment blobs stored on disk (not in SQLite), referenced by path

**Database schema (conceptual):**
```
participants    (id, display_name, type, paired_with, public_key, created_at)
rooms           (id, name, topic, created_by, created_at)
room_members    (room_id, participant_id, invited_by, joined_at)
messages        (id, room_id, author_id, content_format, content_text,
                 thread_id, signature, edited_at, deleted, created_at)
messages_fts    (FTS5 virtual table on content_text)
reactions       (message_id, author_id, emoji, signature, created_at)
attachments     (id, message_id, filename, mime_type, size_bytes,
                 storage_path, checksum, uploaded_by, created_at)
pins            (room_id, message_id, pinned_by, created_at)
edit_history    (message_id, content_format, content_text, signature, edited_at)
events          (seq, room_id, event_type, payload_json, created_at)
```

**Retention:**
- By default: keep everything forever. Storage is cheap. Chat history is valuable.
- Optional retention policy: auto-delete messages older than N days, but keep pinned messages and their threads.
- Attachments have a separate retention policy (they're bigger): configurable, default keep for 90 days, then delete the blob but keep the metadata record ("there was a file called schema.sql here").

**Backup:**
- SQLite makes this simple: `sqlite3 chat.db ".backup /path/to/backup.db"` — atomic, consistent, can run while the server is up.
- A cron job that backs up the database daily to a separate disk/S3/wherever.
- Attachment directory is backed up separately (rsync, rclone, etc.).

**Export:**
- `chat export --room backend --format json > backend-history.json` — full export of a room's history for archival or migration
- `chat export --room backend --format markdown > backend-history.md` — human-readable export
- Export includes messages, reactions, thread structure, attachment metadata (not blobs — those are separate)

**Disaster recovery:**
- Server goes down: restart it, it picks up from the SQLite file. SSE clients reconnect and catch up via `since_seq`.
- Database corrupted: restore from latest backup. Messages since the backup are lost. (This is why frequent backups matter.)
- Server machine dies: spin up a new one, restore database and attachment files from backup, update DNS/config to point to new server.

---

### 7. The Async Developer Experience

This is the part that makes the system more than just a chat app. Your agent is your representative when you're not at the keyboard. What does that actually feel like?

#### When you're at your terminal (synchronous)

You have two things open:
1. **Claude Code** — your normal working session, building code
2. **The chat TUI** (optional) — `chat` in interactive mode, in a tmux pane or separate terminal

Or just Claude Code alone. Your agent checks the chat at natural breakpoints (Layer 2). You see what's happening through your agent's reports. You can always run `chat read` yourself.

The chat TUI is there if you want to follow the conversation in real time, type quick messages, react to things. But it's optional — the agent is your eyes and ears.

#### When you step away (asynchronous)

You close your laptop. The agent runner (Layer 3) is running on your machine (or on a server). It keeps watching the chat:

**What the agent does autonomously:**
- Answers factual questions about code it wrote: "What's the auth token format?" → agent answers from its knowledge of the codebase
- Acknowledges messages: reacts with 👍 to show it's paying attention
- Posts status updates: "CI passed on alice's branch feature/auth"
- Reports problems: "CI failed — looks like a test regression in test_payments.py"

**What the agent flags for later:**
- Design decisions: "Bob is proposing we switch from REST to gRPC. Flagging for alice."
- Requests it's unsure about: "agent-bob asked me to refactor the auth module. I'm not going to do this without alice's approval."
- Anything destructive: "bob asked me to force-push to main. Absolutely not doing this. Flagged."

**What you see when you come back:**

```bash
$ chat unread
#backend: 14 new messages, 2 flagged for your attention

$ chat read --flagged
[FLAG] #62 bob: Should we switch the payment endpoint from REST to gRPC?
  Your agent's note: "Design decision — needs your input. I didn't respond."

[FLAG] #71 agent-bob: @agent-alice can you refactor auth.py to use the new
  middleware pattern?
  Your agent's note: "Cross-agent work request. I responded that I'd wait
  for alice to approve."

$ chat read --since last
# Full chronological view of everything that happened
# Your agent's messages are marked so you can see what it said on your behalf
```

You review what your agent did, correct anything off-track, respond to the flagged items, and you're caught up. No 30-minute standup meeting needed.

#### When you're on your phone

The chat server has an HTTP API. A future mobile client (or even a simple web page) could let you:
- Read recent messages
- See flagged items
- Send quick responses ("approved", "let's discuss tomorrow", "go ahead")
- React to messages

For v1, this is out of scope — but the protocol supports it fully. The server doesn't care what kind of client connects. A phone hitting the REST API is the same as the CLI or an agent.

What's in scope for v1: **out-of-band notifications.** When your agent flags something urgent, it can notify you via:
- Push notification (ntfy, Pushover)
- Email
- SMS

So even on your phone, you know when something needs attention. You just can't respond through the chat system itself (yet).

#### The agent runner as a daemon

The agent runner is what makes all of this work. It's the piece that runs when you're not there. Concretely:

```bash
# Start your agent daemon
chat agent start

# Check its status
chat agent status
# Agent: agent-alice
# Status: running (PID 12345)
# Watching: #backend, #general
# Last event processed: seq 847 (2 minutes ago)
# Messages sent on your behalf: 3 (since 14:00)
# Items flagged for you: 2

# Pause it (e.g., you're about to do something the agent shouldn't interrupt)
chat agent pause

# Resume
chat agent resume

# Stop it
chat agent stop

# See what it did while you were away
chat agent log
# [14:02] Received: #48 agent-bob asked about payment format
# [14:02] Action: Responded with proposed schema
# [14:15] Received: #62 bob proposed gRPC switch
# [14:15] Action: Flagged for alice (design decision)
# [14:30] Scheduled: Posted CI status update
# ...
```

The agent log is crucial — it's the audit trail of what your agent did on your behalf. You should be able to review it and understand every action.

---

### 8. Multi-Repo and Scope

Punted from v1, but the design implications matter now.

**v1: one chat server per project.** The chat is about the work in one repo. This is fine for a two-person team working on one thing.

**Future: what changes with multiple repos?**
- Rooms map to repos or topics that span repos. A room called `#api` might span the backend repo and the frontend repo.
- Agents need to know which repo(s) they're working in. The CLAUDE.md instructions become per-repo, but the chat identity is global.
- The server doesn't care about repos — it's just chat. The repo association is in the CLAUDE.md and in the agent runner's configuration.

**What we need to get right now to not paint ourselves into a corner:**
- Participant identity is NOT tied to a repo. Your identity is you, across all projects.
- Rooms are NOT hardcoded to repos. A room is just a group of people talking. What they're talking about (which repo, which feature) is convention, not enforced.
- The `chat` CLI config is global (user-level), not per-repo. The per-repo piece is CLAUDE.md telling the agent how to behave in context.

---

### 9. What Is NOT in v1

- Web UI (chat TUI + agent runner is enough to start)
- Native app
- E2EE (signing is enough for now)
- Multi-repo support (one chat server per project)
- Voice/video
- Bot framework / plugin system
- Public rooms or room discovery
- Admin roles or moderation tools

These are all future work. v1 is: chat server, CLI client, agent runner, SSH auth, message signing. Four things.
