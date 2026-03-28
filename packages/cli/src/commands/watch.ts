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

    // Fetch participant names
    const nameMap = new Map<string, string>();
    try {
      const res = await fetch(
        `${config.server_url}/rooms/${roomId}/participants`,
        { headers: { Authorization: `Bearer ${config.session_token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        for (const p of data.items) nameMap.set(p.id, p.display_name);
      }
    } catch {
      // Non-fatal
    }

    console.log("Watching for messages... (Ctrl+C to stop)\n");

    let lastEventId = "0";
    let retryDelay = 1000;
    const maxDelay = 30000;

    while (true) {
      try {
        const url = `${config.server_url}/rooms/${roomId}/events/stream`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${config.session_token}`,
            Accept: "text/event-stream",
            ...(lastEventId !== "0" && { "Last-Event-ID": lastEventId }),
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        retryDelay = 1000; // Reset on successful connect
        if (lastEventId !== "0") {
          console.log("  (reconnected)\n");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let currentData = "";
        let currentId = "";

        while (true) {
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

              if (currentEvent === "message.created" && currentData) {
                try {
                  const payload = JSON.parse(currentData);
                  const time = new Date(payload.created_at).toLocaleTimeString(
                    "en-US",
                    { hour: "2-digit", minute: "2-digit", hour12: false },
                  );
                  const author =
                    nameMap.get(payload.author_id) ??
                    payload.author_id.slice(0, 8);
                  console.log(`[${time}] ${author}: ${payload.content?.text ?? ""}`);
                } catch {
                  // Ignore parse errors
                }
              }

              currentEvent = "";
              currentData = "";
              currentId = "";
            }
          }
        }
      } catch (e) {
        const jitter = Math.random() * 1000;
        const delay = retryDelay + jitter;
        console.error(
          `  (disconnected, reconnecting in ${Math.round(delay / 1000)}s...)`,
        );
        await new Promise((r) => setTimeout(r, delay));
        retryDelay = Math.min(retryDelay * 2, maxDelay);
      }
    }
  });
