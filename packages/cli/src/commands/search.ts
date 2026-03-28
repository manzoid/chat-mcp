import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const searchCommand = new Command("search")
  .description("Search messages")
  .argument("<query>", "Search query")
  .option("--room <id>", "Room to search in")
  .option("--author <id>", "Filter by author")
  .action(async (query, opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;
    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    let path = `/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`;
    if (opts.author) {
      path += `&author=${opts.author}`;
    }

    const result = await api.get(path);

    if (result.items.length === 0) {
      console.log("No results.");
      return;
    }

    for (const msg of result.items) {
      const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const id = msg.id.slice(0, 8);
      console.log(`[${time}] #${id}: ${msg.content_text}`);
    }
  });
