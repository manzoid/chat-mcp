import { Command } from "commander";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const deleteCommand = new Command("delete")
  .description("Delete a message")
  .argument("<message-id>", "Message ID")
  .action(async (messageId) => {
    const config = loadConfig();
    const api = new ApiClient(config);
    await api.delete(`/messages/${messageId}`);
    console.log(`Deleted #${messageId.slice(0, 8)}`);
  });
