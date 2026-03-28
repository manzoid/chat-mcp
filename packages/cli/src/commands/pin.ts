import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const pinCommand = new Command("pin")
  .description("Pin a message")
  .argument("<message-id>", "Message ID")
  .action(async (messageId) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.post(`/messages/${messageId}/pin`, {});
    console.log(`Pinned #${messageId.slice(0, 8)}`);
  });

export const unpinCommand = new Command("unpin")
  .description("Unpin a message")
  .argument("<message-id>", "Message ID")
  .action(async (messageId) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.delete(`/messages/${messageId}/pin`);
    console.log(`Unpinned #${messageId.slice(0, 8)}`);
  });

export const pinsCommand = new Command("pins")
  .description("List pinned messages")
  .option("--room <id>", "Room ID")
  .action(async (opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;
    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    const result = await api.get(`/rooms/${roomId}/pins`);

    if (result.items.length === 0) {
      console.log("No pinned messages.");
      return;
    }

    for (const msg of result.items) {
      const id = msg.id.slice(0, 8);
      console.log(`  #${id}: ${msg.content_text}`);
    }
  });
