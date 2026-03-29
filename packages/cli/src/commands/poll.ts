import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = process.env.CHAT_MCP_CONFIG_DIR ?? join(process.env.HOME ?? "~", ".config", "chat-mcp");
const STATE_FILE = join(STATE_DIR, "poll_state.json");

function loadState(): { last_seq: number } {
  if (!existsSync(STATE_FILE)) return { last_seq: 0 };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { last_seq: 0 };
  }
}

function saveState(state: { last_seq: number }): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

export const pollCommand = new Command("poll")
  .description("Check for new messages since last poll (for hooks)")
  .option("--room <id>", "Room to poll")
  .option("--quiet", "No output if no new messages")
  .action(async (opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;

    if (!roomId || !config.session_token) {
      // Silently exit if not configured — don't break the hook
      process.exit(0);
    }

    const api = new ApiClient(config);
    const state = loadState();

    try {
      const result = await api.get(`/rooms/${roomId}/events?since_seq=${state.last_seq}`);

      if (!result.items || result.items.length === 0) {
        process.exit(0);
      }

      // Filter to just message.created events from OTHER participants
      const newMessages = result.items.filter(
        (e: any) =>
          e.type === "message.created" &&
          e.payload?.author_id !== config.participant_id,
      );

      if (newMessages.length > 0) {
        // Fetch participant names
        const nameMap = new Map<string, string>();
        try {
          const participants = await api.get(`/rooms/${roomId}/participants`);
          for (const p of participants.items) {
            nameMap.set(p.id, p.display_name);
          }
        } catch {
          // Non-fatal
        }

        console.log(`\n--- New chat messages (${newMessages.length}) ---`);
        for (const event of newMessages) {
          const p = event.payload;
          const author = nameMap.get(p.author_id) ?? p.author_id.slice(0, 8);
          const text = p.content?.text ?? "";
          const threadTag = p.thread_id ? ` [thread:${p.thread_id.slice(0, 8)}]` : "";
          console.log(`[${author}]${threadTag}: ${text}`);
        }
        console.log(`--- end chat messages ---\n`);
      }

      // Update state to latest seq
      saveState({ last_seq: result.next_seq });
    } catch {
      // Silently fail — don't break the hook
      process.exit(0);
    }
  });
