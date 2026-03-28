import { Command } from "commander";
import { v4 as uuid } from "uuid";
import { sign } from "@chat-mcp/shared";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const sendCommand = new Command("send")
  .description("Send a message to the current room")
  .argument("<text>", "Message text")
  .option("--thread <id>", "Reply to a thread")
  .option("--room <id>", "Send to a specific room")
  .action(async (text, opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;

    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    if (!config.ssh_key_path) {
      console.error("No SSH key configured. Run: chat auth register");
      process.exit(1);
    }

    const api = new ApiClient(config);
    const nonce = uuid();
    const content = { format: "plain" as const, text };
    const payload = {
      room_id: roomId,
      content,
      thread_id: opts.thread ?? null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp: new Date().toISOString(),
    };

    const signature = await sign(config.ssh_key_path, payload);

    const result = await api.post(`/rooms/${roomId}/messages`, {
      content,
      thread_id: opts.thread ?? undefined,
      mentions: [],
      attachments: [],
      nonce,
      timestamp: payload.timestamp,
      signature,
    });

    console.log(`Sent: ${text} (#${result.id.slice(0, 8)})`);
  });
