import { Command } from "commander";
import { sign } from "@chat-mcp/shared";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const reactCommand = new Command("react")
  .description("React to a message")
  .argument("<message-id>", "Message ID (or prefix)")
  .argument("<emoji>", "Emoji or shortcode")
  .action(async (messageId, emoji) => {
    const config = loadConfig();
    if (!config.ssh_key_path) {
      console.error("No SSH key configured. Run: chat auth register");
      process.exit(1);
    }

    const api = new ApiClient(config);

    const reactionPayload = {
      message_id: messageId,
      emoji,
      author_id: config.participant_id,
    };
    const signature = await sign(config.ssh_key_path, reactionPayload);

    await api.post(`/messages/${messageId}/reactions`, { emoji, signature });
    console.log(`Reacted ${emoji} to #${messageId.slice(0, 8)}`);
  });

export const unreactCommand = new Command("unreact")
  .description("Remove a reaction")
  .argument("<message-id>", "Message ID (or prefix)")
  .argument("<emoji>", "Emoji or shortcode")
  .action(async (messageId, emoji) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.delete(`/messages/${messageId}/reactions/${emoji}`);
    console.log(`Removed ${emoji} from #${messageId.slice(0, 8)}`);
  });
