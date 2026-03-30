import { Command } from "commander";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Static, Box, Text, useInput, useApp } from "ink";
import { v4 as uuid } from "uuid";
import { sign } from "@chat-mcp/shared";
import { loadConfig, type CliConfig } from "../config.js";
import { ApiClient } from "../api.js";

interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  time: string;
  edited: boolean;
  reactions: { emoji: string; count: number }[];
}

interface AppProps {
  config: CliConfig;
  roomId: string;
  roomName: string;
  initialMessages: ChatMessage[];
  participants: Map<string, string>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function MessageLine({ msg, selfName }: { msg: ChatMessage; selfName?: string }) {
  const parts: React.ReactNode[] = [];
  const regex = /@(\S+)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(msg.text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(msg.text.slice(lastIndex, match.index));
    }
    const mention = match[0];
    const isSelf = selfName && match[1] === selfName;
    parts.push(
      <Text key={match.index} color={isSelf ? "yellow" : "cyan"} bold={!!isSelf}>
        {mention}
      </Text>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < msg.text.length) {
    parts.push(msg.text.slice(lastIndex));
  }

  const reactionStr =
    msg.reactions.length > 0
      ? " " + msg.reactions.map((r) => `[${r.emoji}:${r.count}]`).join(" ")
      : "";

  return (
    <Text>
      <Text dimColor>[{msg.time}]</Text>{" "}
      <Text bold color="green">{msg.authorName}</Text>
      <Text>: </Text>
      {parts}
      {msg.edited && <Text dimColor> (edited)</Text>}
      {reactionStr && <Text color="magenta">{reactionStr}</Text>}
    </Text>
  );
}

// --- Custom input with @mention autocomplete ---

function fuzzyMatch(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  // Substring match on any part
  if (n.includes(q)) return true;
  // Also match across segments: "manz" matches "manzoid_test-intent-map_A"
  // and "intent" matches it too
  const segments = n.split(/[_-]/);
  return segments.some((seg) => seg.startsWith(q));
}

interface ChatInputProps {
  onSubmit: (text: string) => void;
  participantNames: string[];
}

function ChatInput({ onSubmit, participantNames }: ChatInputProps) {
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1); // char index of the '@'

  // Detect @mention in progress and update suggestions
  function updateSuggestions(newText: string, newCursor: number) {
    // Walk back from cursor to find '@'
    let atPos = -1;
    for (let i = newCursor - 1; i >= 0; i--) {
      if (newText[i] === "@") {
        atPos = i;
        break;
      }
      if (newText[i] === " ") break; // stop at space before @
    }

    if (atPos >= 0) {
      const query = newText.slice(atPos + 1, newCursor);
      if (query.length > 0) {
        const matches = participantNames
          .filter((name) => fuzzyMatch(query, name))
          .slice(0, 5);
        setSuggestions(matches);
        setSelectedIdx(0);
        setMentionStart(atPos);
        return;
      }
    }
    setSuggestions([]);
    setMentionStart(-1);
  }

  useInput((input, key) => {
    // Quit
    if (key.escape && suggestions.length > 0) {
      setSuggestions([]);
      setMentionStart(-1);
      return;
    }
    if (key.escape || (input === "c" && key.ctrl)) {
      // Let parent handle exit
      return;
    }

    // Tab: accept suggestion
    if (key.tab && suggestions.length > 0) {
      const selected = suggestions[selectedIdx];
      const before = text.slice(0, mentionStart);
      const after = text.slice(cursor);
      const newText = `${before}@${selected} ${after}`;
      const newCursor = before.length + 1 + selected.length + 1;
      setText(newText);
      setCursor(newCursor);
      setSuggestions([]);
      setMentionStart(-1);
      return;
    }

    // Navigate suggestions
    if (key.upArrow && suggestions.length > 0) {
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
      return;
    }
    if (key.downArrow && suggestions.length > 0) {
      setSelectedIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
      return;
    }

    // Submit
    if (key.return) {
      if (suggestions.length > 0) {
        // Accept current suggestion on Enter too
        const selected = suggestions[selectedIdx];
        const before = text.slice(0, mentionStart);
        const after = text.slice(cursor);
        const newText = `${before}@${selected} ${after}`;
        setText("");
        setCursor(0);
        setSuggestions([]);
        setMentionStart(-1);
        onSubmit(newText.trim());
      } else if (text.trim()) {
        const t = text;
        setText("");
        setCursor(0);
        onSubmit(t.trim());
      }
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const newText = text.slice(0, cursor - 1) + text.slice(cursor);
        const newCursor = cursor - 1;
        setText(newText);
        setCursor(newCursor);
        updateSuggestions(newText, newCursor);
      }
      return;
    }

    // Arrow keys (no suggestions)
    if (key.leftArrow) {
      setCursor((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((prev) => Math.min(text.length, prev + 1));
      return;
    }

    // Home/End
    if (input === "a" && key.ctrl) {
      setCursor(0);
      return;
    }
    if (input === "e" && key.ctrl) {
      setCursor(text.length);
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      const newText = text.slice(0, cursor) + input + text.slice(cursor);
      const newCursor = cursor + input.length;
      setText(newText);
      setCursor(newCursor);
      updateSuggestions(newText, newCursor);
    }
  });

  // Render the input line with cursor
  const before = text.slice(0, cursor);
  const cursorChar = text[cursor] ?? " ";
  const after = text.slice(cursor + 1);

  return (
    <>
      <Box paddingX={1}>
        <Text bold color="green">&gt; </Text>
        <Text>{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{after}</Text>
      </Box>
      {suggestions.length > 0 && (
        <Box flexDirection="column" paddingX={3}>
          {suggestions.map((name, i) => (
            <Text key={name} color={i === selectedIdx ? "green" : "gray"}>
              {i === selectedIdx ? "→ " : "  "}@{name}
            </Text>
          ))}
        </Box>
      )}
    </>
  );
}

// --- Main App ---

function App({ config, roomId, roomName, initialMessages, participants }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [nameMap, setNameMap] = useState(participants);
  const nameMapRef = useRef(nameMap);
  nameMapRef.current = nameMap;
  const [status, setStatus] = useState("connected");
  const [busyParticipants, setBusyParticipants] = useState<Map<string, string>>(new Map());

  const selfName = config.participant_id
    ? nameMap.get(config.participant_id)
    : undefined;

  const participantNames = [...nameMap.values()];

  // Resolve an unknown participant ID to a display name
  const resolveAuthor = useCallback(async (authorId: string): Promise<string> => {
    const known = nameMapRef.current.get(authorId);
    if (known) return known;
    try {
      const res = await fetch(`${config.server_url}/participants/${authorId}`, {
        headers: { Authorization: `Bearer ${config.session_token}`, "X-Chat-Protocol-Version": "1" },
      });
      if (res.ok) {
        const p = await res.json();
        const name = p.display_name ?? authorId.slice(0, 8);
        setNameMap((prev) => { const next = new Map(prev); next.set(authorId, name); return next; });
        return name;
      }
    } catch {}
    return authorId.slice(0, 8);
  }, [config.server_url, config.session_token]);

  // SSE connection
  useEffect(() => {
    let aborted = false;
    let retryDelay = 1000;
    const maxDelay = 30000;
    let lastEventId = "0";

    async function connect() {
      while (!aborted) {
        try {
          const res = await fetch(
            `${config.server_url}/rooms/${roomId}/events/stream`,
            {
              headers: {
                Authorization: `Bearer ${config.session_token}`,
                Accept: "text/event-stream",
                ...(lastEventId !== "0" && { "Last-Event-ID": lastEventId }),
              },
            },
          );

          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const reader = res.body?.getReader();
          if (!reader) throw new Error("No body");

          retryDelay = 1000;
          setStatus("connected");

          const decoder = new TextDecoder();
          let buffer = "";
          let currentEvent = "";
          let currentData = "";
          let currentId = "";

          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) throw new Error("Stream ended");

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
              else if (line.startsWith("data:")) currentData = line.slice(5).trim();
              else if (line.startsWith("id:")) currentId = line.slice(3).trim();
              else if (line === "" && currentData) {
                if (currentId) lastEventId = currentId;
                handleEvent(currentEvent, currentData);
                currentEvent = "";
                currentData = "";
                currentId = "";
              }
            }
          }
        } catch {
          if (aborted) return;
          setStatus("reconnecting...");
          const jitter = Math.random() * 1000;
          await new Promise((r) => setTimeout(r, retryDelay + jitter));
          retryDelay = Math.min(retryDelay * 2, maxDelay);
        }
      }
    }

    function handleEvent(event: string, data: string) {
      try {
        const payload = JSON.parse(data);
        if (event === "message.created") {
          const authorId = payload.author_id;
          const knownName = nameMapRef.current.get(authorId);
          const tempName = knownName ?? authorId?.slice(0, 8) ?? "?";
          setMessages((prev) => [
            ...prev,
            {
              id: payload.id,
              authorId,
              authorName: tempName,
              text: payload.content?.text ?? "",
              time: formatTime(payload.created_at),
              edited: false,
              reactions: [],
            },
          ]);
          // If unknown, resolve and update
          if (!knownName && authorId) {
            resolveAuthor(authorId).then((name) => {
              setMessages((prev) =>
                prev.map((m) => m.id === payload.id ? { ...m, authorName: name } : m),
              );
            });
          }
        } else if (event === "message.edited") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.message_id
                ? { ...m, text: payload.content?.text ?? m.text, edited: true }
                : m,
            ),
          );
        } else if (event === "reaction.added") {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== payload.message_id) return m;
              const emoji = payload.reaction?.emoji ?? payload.emoji;
              const existing = m.reactions.find((r) => r.emoji === emoji);
              if (existing) {
                return {
                  ...m,
                  reactions: m.reactions.map((r) =>
                    r.emoji === emoji ? { ...r, count: r.count + 1 } : r,
                  ),
                };
              }
              return { ...m, reactions: [...m.reactions, { emoji, count: 1 }] };
            }),
          );
        } else if (event === "participant.status") {
          const pid = payload.participant_id;
          const name = nameMapRef.current.get(pid) ?? pid?.slice(0, 8) ?? "?";
          if (payload.state === "busy") {
            setBusyParticipants((prev) => {
              const next = new Map(prev);
              next.set(pid, payload.description ? `${name}: ${payload.description}` : `${name} is thinking...`);
              return next;
            });
          } else {
            setBusyParticipants((prev) => {
              const next = new Map(prev);
              next.delete(pid);
              return next;
            });
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    connect();
    return () => {
      aborted = true;
    };
  }, [roomId, config.server_url, config.session_token]);

  // Handle sending
  const handleSubmit = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      try {
        const api = new ApiClient(config);
        const nonce = uuid();
        const timestamp = new Date().toISOString();
        const content = { format: "plain" as const, text: text.trim() };
        const payload = {
          room_id: roomId,
          content,
          thread_id: null,
          mentions: [],
          attachments: [],
          nonce,
          timestamp,
        };
        const signature = await sign(config.ssh_key_path!, payload);

        await api.post(`/rooms/${roomId}/messages`, {
          content,
          mentions: [],
          attachments: [],
          nonce,
          timestamp,
          signature,
        });
      } catch (e: any) {
        setStatus(`send error: ${e.message}`);
        setTimeout(() => setStatus("connected"), 3000);
      }
    },
    [config, roomId],
  );

  // Keyboard: quit (only when no suggestions showing)
  useInput((ch, key) => {
    if (key.escape || (ch === "c" && key.ctrl)) {
      exit();
    }
  });

  // Split messages for Static/dynamic rendering
  const staticMessages = messages.slice(0, Math.max(0, messages.length - 3));
  const dynamicMessages = messages.slice(Math.max(0, messages.length - 3));

  return (
    <>
      <Static items={staticMessages}>
        {(msg) => (
          <Box key={msg.id} paddingX={1}>
            <MessageLine msg={msg} selfName={selfName} />
          </Box>
        )}
      </Static>

      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(Math.min(80, process.stdout.columns - 4))}</Text>
      </Box>
      {dynamicMessages.map((msg) => (
        <Box key={msg.id} paddingX={1}>
          <MessageLine msg={msg} selfName={selfName} />
        </Box>
      ))}
      {busyParticipants.size > 0 && (
        <Box paddingX={1}>
          <Text dimColor italic>
            {[...busyParticipants.values()].join("  ·  ")}
          </Text>
        </Box>
      )}
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(Math.min(80, process.stdout.columns - 4))}</Text>
      </Box>
      <ChatInput onSubmit={handleSubmit} participantNames={participantNames} />
    </>
  );
}

export const tuiCommand = new Command("tui")
  .description("Interactive chat terminal UI")
  .option("--room <id>", "Room to connect to")
  .action(async (opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;

    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }
    if (!config.session_token) {
      console.error("Not authenticated. Run: chat auth login");
      process.exit(1);
    }
    if (!config.ssh_key_path) {
      console.error("No SSH key configured. Run: chat auth register");
      process.exit(1);
    }

    const api = new ApiClient(config);

    let roomName = roomId.slice(0, 8);
    try {
      const room = await api.get(`/rooms/${roomId}`);
      roomName = room.name ?? roomName;
    } catch {}

    const nameMap = new Map<string, string>();
    try {
      const parts = await api.get(`/rooms/${roomId}/participants`);
      for (const p of parts.items) {
        nameMap.set(p.id, p.display_name);
      }
    } catch {}

    const initialMessages: ChatMessage[] = [];
    try {
      const result = await api.get(`/rooms/${roomId}/messages?limit=50`);
      for (const msg of [...result.items].reverse()) {
        initialMessages.push({
          id: msg.id,
          authorId: msg.author_id,
          authorName: nameMap.get(msg.author_id) ?? msg.author_id.slice(0, 8),
          text: msg.content_text,
          time: formatTime(msg.created_at),
          edited: !!msg.edited_at,
          reactions: [],
        });
      }
    } catch {}

    render(
      <App
        config={config}
        roomId={roomId}
        roomName={roomName}
        initialMessages={initialMessages}
        participants={nameMap}
      />,
    );
  });
