import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const readCommand = new Command("read")
  .description("Read messages from the current room")
  .option("--last <n>", "Number of messages to show", "20")
  .option("--thread <id>", "Show messages in a thread")
  .option("--room <id>", "Read from a specific room")
  .action(async (opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;

    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    let path = `/rooms/${roomId}/messages?limit=${opts.last}`;
    if (opts.thread) {
      path += `&thread_id=${opts.thread}`;
    }

    // Fetch participants for name resolution
    const participants = await api.get(`/rooms/${roomId}/participants`);
    const nameMap = new Map<string, string>();
    for (const p of participants.items) {
      nameMap.set(p.id, p.display_name);
    }

    const result = await api.get(path);

    // Messages come newest-first, reverse for display
    const messages = [...result.items].reverse();

    if (messages.length === 0) {
      console.log("No messages yet.");
      return;
    }

    for (const msg of messages) {
      const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const author = nameMap.get(msg.author_id) ?? msg.author_id.slice(0, 8);
      const id = msg.id.slice(0, 8);
      console.log(`[${time}] ${author}: ${msg.content_text}  (#${id})`);
    }

    if (result.has_more) {
      console.log(`  ... more messages available (use --last to increase)`);
    }
  });
