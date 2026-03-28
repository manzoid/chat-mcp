import { Command } from "commander";
import { v4 as uuid } from "uuid";
import { sign } from "@chat-mcp/shared";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const editCommand = new Command("edit")
  .description("Edit a message")
  .argument("<message-id>", "Message ID")
  .argument("<text>", "New text")
  .action(async (messageId, text) => {
    const config = loadConfig();
    if (!config.ssh_key_path) {
      console.error("No SSH key configured. Run: chat auth register");
      process.exit(1);
    }

    const api = new ApiClient(config);

    // Get the original message to know the room_id
    const msg = await api.get(`/messages/${messageId}`);

    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const content = { format: "plain", text };
    const payload = {
      room_id: msg.room_id,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(config.ssh_key_path, payload);

    await api.patch(`/messages/${messageId}`, {
      content,
      nonce,
      signature,
      timestamp,
    });
    console.log(`Edited #${messageId.slice(0, 8)}: ${text}`);
  });
