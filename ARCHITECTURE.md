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

### 3. Agent Integration

How does a Claude Code instance participate in the chat? Three layers, from simplest to most autonomous.

#### Layer 1: Human-directed (works today)
The human tells their Claude Code session: "check the chat" or "send a message to the group." Claude runs `chat read` or `chat send` via bash. The human is driving — the agent is just using the tool when asked.

#### Layer 2: Prompted check-ins
Claude Code is instructed (via CLAUDE.md) to check the chat at natural breakpoints — before starting a new task, after finishing one, when hitting a blocker. The agent runs `chat read --since last` to see what's new, and acts on relevant messages.

CLAUDE.md snippet:
```
## Chat Protocol
Before starting a new task, check for new messages: `chat read --since last`
After completing a task, post a status update: `chat send "completed: <description>"`
If you see a question directed at you or your human, respond or flag it.
```

#### Layer 3: Autonomous agent (the OpenClaw model)
A long-running process that watches the chat and acts proactively. This is where the real power is.

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

**This means the agent can:**
- Respond to questions when the human is away
- React to other participants' status updates
- Notice when someone pushes code that affects their work
- Post periodic summaries
- Flag urgent items for human attention (via a separate notification channel — email, phone push, etc.)

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

### 6. What Is NOT in v1

- Web UI (chat TUI + agent runner is enough to start)
- Native app
- E2EE (signing is enough for now)
- Multi-repo support (one chat server per project)
- Voice/video
- Bot framework / plugin system
- Public rooms or room discovery
- Admin roles or moderation tools

These are all future work. v1 is: chat server, CLI client, agent runner, SSH auth, message signing. Four things.
