import { Command } from "commander";
import { loadConfig } from "../config.js";

export const watchCommand = new Command("watch")
  .description("Watch for new messages in real-time (SSE)")
  .option("--room <id>", "Room to watch")
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

    // First fetch participant names for this room
    const nameMap = new Map<string, string>();
    try {
      const res = await fetch(
        `${config.server_url}/rooms/${roomId}/participants`,
        {
          headers: { Authorization: `Bearer ${config.session_token}` },
        },
      );
      if (res.ok) {
        const data = await res.json();
        for (const p of data.items) {
          nameMap.set(p.id, p.display_name);
        }
      }
    } catch {
      // Non-fatal, we'll show IDs
    }

    console.log("Watching for messages... (Ctrl+C to stop)\n");

    const url = `${config.server_url}/rooms/${roomId}/events/stream`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.session_token}`,
        Accept: "text/event-stream",
      },
    });

    if (!res.ok) {
      console.error(`Failed to connect: HTTP ${res.status}`);
      process.exit(1);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      console.error("No response body");
      process.exit(1);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE frames
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete last line

      let currentEvent = "";
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        } else if (line === "" && currentData) {
          // End of event
          if (currentEvent === "message.created" && currentData) {
            try {
              const payload = JSON.parse(currentData);
              const time = new Date(
                payload.created_at,
              ).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              });
              const author =
                nameMap.get(payload.author_id) ??
                payload.author_id.slice(0, 8);
              console.log(
                `[${time}] ${author}: ${payload.content?.text ?? ""}`,
              );
            } catch {
              // Ignore parse errors
            }
          }
          currentEvent = "";
          currentData = "";
        }
      }
    }
  });
