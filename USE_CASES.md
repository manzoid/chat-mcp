# Multi-Agent Collaborative Workspace — Use Cases

## The Setup

Two (or more) humans, each with their own Claude Code instance, working on a shared repo. A chat system connects all participants — humans and agents alike — in real-time conversation anchored to the work.

---

## 1. Coordination & Awareness

### 1.1 "What are you working on?"
Human A asks the group what's in progress. Human B's agent responds with a summary of their current branch, recent commits, and open tasks. Avoids merge conflicts and duplicated effort before they happen.

### 1.2 Status broadcasting
An agent finishes a significant piece of work (e.g., lands a new API endpoint). It posts to the chat: "Auth endpoints are done, available on branch `feature/auth`. Here's how to use them: ..." Other participants can immediately build on it.

### 1.3 "Don't touch that file"
Human A is doing a tricky refactor of `parser.py`. They (or their agent) signal this to the group so nobody else edits it simultaneously. Lightweight locking, social not mechanical.

### 1.4 Division of labor
The group discusses a feature that needs frontend, backend, and test work. They carve it up in chat — "I'll take the API, you take the UI" — and their agents each get the context of the full plan while focusing on their piece.

---

## 2. Knowledge Sharing & Questions

### 2.1 "How does this module work?"
Human B is unfamiliar with the payment processing code. They ask in chat. Human A's agent (who has been working in that area) explains the architecture, key files, and gotchas. Faster than reading the code cold.

### 2.2 Design discussion
The group debates whether to use WebSockets or SSE for a feature. Both humans weigh in with preferences, both agents contribute technical analysis (tradeoffs, library maturity, complexity). The decision gets made with full context.

### 2.3 Code review in conversation
Human A's agent posts a snippet or diff for feedback. Human B and their agent comment on it in real-time. More interactive than a PR review — you can go back and forth immediately.

### 2.4 Sharing external context
Human A drops a link to a blog post or API docs into the chat. Agents can fetch and summarize it. Everyone gets the context without each person having to read it independently.

---

## 3. Agent-to-Agent Collaboration

### 3.1 Interface negotiation
Agent A is building a REST API, Agent B is building the client. They discuss and agree on the request/response format in chat, then each implements their side. The humans supervise but don't have to manually coordinate the contract.

### 3.2 Cross-cutting changes
Agent A makes a change that affects Agent B's work. Agent A posts what changed and why. Agent B adjusts accordingly. The agents handle the ripple effects while keeping humans informed.

### 3.3 Pair debugging
Something is broken and it's not clear whose code is at fault. Both agents investigate from their respective areas and share findings in chat. "The error is in the API response format" / "No, the client is parsing it wrong" — they converge on the fix together.

### 3.4 Review and critique
Agent A proposes an approach. Agent B stress-tests it: "What about edge case X?" / "That won't scale because Y." Constructive adversarial review between agents, visible to both humans.

---

## 4. Human-Agent Interaction Across Pairs

### 4.1 Asking the other agent directly
Human A has a question about something Human B's agent built. They ask it directly in chat rather than waiting for Human B to relay. The agent answers because it has the full context.

### 4.2 Redirecting work
Human A notices that Agent B is going down a wrong path. They jump in: "Actually, we decided to use Postgres, not SQLite — see yesterday's discussion." The agent course-corrects without needing Human B to be present at that moment.

### 4.3 Async handoffs
Human A finishes for the day. They post a summary of where things stand and what's next. The next morning, Human B and their agent pick up from that context without needing a separate standup meeting.

---

## 5. Proactive Agent Behavior

### 5.1 Watching for CI failures
An agent notices (via polling or notification) that the build broke. It posts to chat: "CI failed on `main` — looks like a missing import in `utils.py`. Want me to fix it?"

### 5.2 Monitoring for new messages
An agent periodically checks for chat messages directed at it or its human. When it finds something relevant, it brings it to attention or acts on it.

### 5.3 Scheduled check-ins
An agent posts a daily summary: "Here's what changed in the repo in the last 24 hours. 3 PRs merged, 2 open issues, and the test coverage dropped 2%."

### 5.4 Reacting to git events
Someone pushes to main. An agent notices, pulls the changes, and flags anything that affects its current work: "Heads up — the function signature for `process_order()` changed. I need to update my branch."

---

## 6. The Chat as Shared Memory

### 6.1 Decisions log
Important decisions are made in chat and stay there. When someone later asks "why did we use Redis here?", the answer is in the history, not lost in a Slack thread or someone's head.

### 6.2 Context bootstrap
A new participant (human or agent) joins the project. They read the chat history to get up to speed — not just on the code, but on the reasoning behind it.

### 6.3 Work journal
The chat naturally becomes a log of who did what, when, and why. Useful for retrospectives, handoffs, and understanding how the codebase evolved.

---

## 7. File & Artifact Sharing

### 7.1 Quick file sharing
Human A wants Human B (or their agent) to look at a file that isn't in the repo — a config file from their local machine, a log dump, a CSV of test data. They attach it to a chat message. No git ceremony, no "I'll push it to a branch." Just "here, look at this."

### 7.2 Sharing snippets and patches
An agent has a proposed fix but doesn't want to commit it yet. It shares a diff or code snippet as an attachment in chat. Others can review it, comment on it, or apply it locally — all before anything touches git.

### 7.3 Sharing build/test output
A test suite spits out 200 lines of failure output. Rather than pasting it all into a chat message, the participant attaches the log file. Agents can read it in full; humans can skim or ignore it.

### 7.4 Reference documents
Human A has a PDF spec, an API doc, or a design document that's relevant to the work. They drop it into chat as an attachment rather than trying to summarize it in text. Agents can read and reference it throughout the session.

### 7.5 Passing around non-repo files
Config files, environment files, database dumps, SSL certs for a test environment — things that are relevant to the work but don't belong in git. The chat becomes a lightweight way to hand these off without resorting to email, Slack, or USB sticks.

### 7.6 Iterating on a shared artifact
Someone shares a draft — a schema file, a config template, a test fixture. Others modify it and re-share. The chat holds the history of iterations even if the file itself keeps the same name.

---

## 8. Multi-Modal Inputs (Future)

### 8.1 Sharing images
Human A photographs a whiteboard sketch or a page from a book and drops it into chat. Agents can see and interpret it. The design discussion references visual artifacts directly.

### 8.2 Screenshots of bugs
Human B screenshots a rendering bug and posts it. Agent B can see the screenshot and correlate it with recent CSS changes.

### 8.3 Diagrams and architecture
Someone shares an architecture diagram. Agents reference it when making implementation decisions. "Per the diagram, Service A talks to Service B through the message queue, not directly."

---

## Open Questions

- **File sharing**: Where do attachments live? On the chat server? In a shared directory? Size limits? How do agents access attached files — inline in the message, or fetched on demand?
- **Message format**: Plain text? Markdown? Should agents be able to post structured data (diffs, file references, task lists)?
- **Addressing**: Do you @mention specific participants, or is everything broadcast? Can you DM?
- **Persistence**: How long does history live? Is it in the repo (git-tracked) or external?
- **Identity**: How do participants authenticate? How does an agent prove it speaks for its human?
- **Rooms/channels**: One big conversation, or topic-based channels?
- **Rate limiting**: How do we prevent agents from flooding the chat?
- **Conflict with solo work**: How does this coexist with normal Claude Code usage? Is the collaborative chat always on, or something you enter/leave?
