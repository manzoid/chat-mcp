import { Command } from "commander";
import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
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
  // Split text on @mentions
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

function App({ config, roomId, roomName, initialMessages, participants }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [nameMap, setNameMap] = useState(participants);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("connected");
  const [scrollOffset, setScrollOffset] = useState(0);

  const termHeight = process.stdout.rows || 24;
  const messageAreaHeight = termHeight - 4; // header + input + borders

  const selfName = config.participant_id
    ? nameMap.get(config.participant_id)
    : undefined;

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
          const authorName =
            nameMap.get(payload.author_id) ?? payload.author_id?.slice(0, 8) ?? "?";
          setMessages((prev) => [
            ...prev,
            {
              id: payload.id,
              authorId: payload.author_id,
              authorName,
              text: payload.content?.text ?? "",
              time: formatTime(payload.created_at),
              edited: false,
              reactions: [],
            },
          ]);
          // Auto-scroll to bottom on new message
          setScrollOffset(0);
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
      setInput("");

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

  // Keyboard: scroll, quit
  useInput((ch, key) => {
    if (key.escape || (ch === "c" && key.ctrl)) {
      exit();
    }
    if (key.upArrow || key.pageUp) {
      setScrollOffset((prev) => Math.min(prev + (key.pageUp ? 10 : 1), Math.max(0, messages.length - messageAreaHeight)));
    }
    if (key.downArrow || key.pageDown) {
      setScrollOffset((prev) => Math.max(0, prev - (key.pageDown ? 10 : 1)));
    }
  });

  // Visible messages (scroll from bottom)
  const visibleMessages = messages.slice(
    Math.max(0, messages.length - messageAreaHeight - scrollOffset),
    messages.length - scrollOffset,
  );

  const scrollIndicator = scrollOffset > 0 ? ` (+${scrollOffset} more below)` : "";

  return (
    <Box flexDirection="column" height={termHeight}>
      {/* Header */}
      <Box paddingX={1}>
        <Text bold color="blue">#{roomName}</Text>
        <Text dimColor>  {nameMap.size} participants  </Text>
        <Text dimColor color={status === "connected" ? "green" : "yellow"}>
          {status}
        </Text>
        {scrollIndicator && <Text dimColor>{scrollIndicator}</Text>}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(Math.min(80, process.stdout.columns - 4))}</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleMessages.map((msg) => (
          <MessageLine key={msg.id} msg={msg} selfName={selfName} />
        ))}
      </Box>

      {/* Input */}
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(Math.min(80, process.stdout.columns - 4))}</Text>
      </Box>
      <Box paddingX={1}>
        <Text bold color="green">&gt; </Text>
        <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
      </Box>
    </Box>
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

    // Fetch room info
    let roomName = roomId.slice(0, 8);
    try {
      const room = await api.get(`/rooms/${roomId}`);
      roomName = room.name ?? roomName;
    } catch {
      // use fallback name
    }

    // Fetch participants
    const nameMap = new Map<string, string>();
    try {
      const parts = await api.get(`/rooms/${roomId}/participants`);
      for (const p of parts.items) {
        nameMap.set(p.id, p.display_name);
      }
    } catch {
      // proceed without names
    }

    // Fetch initial messages
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
    } catch {
      // start with empty history
    }

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
