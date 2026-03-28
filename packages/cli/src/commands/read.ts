import { Command } from "commander";
import { verify } from "@chat-mcp/shared";
import { loadConfig } from "../config.js";
import { ApiClient } from "../api.js";
import { checkKey } from "../known-keys.js";

export const readCommand = new Command("read")
  .description("Read messages from the current room")
  .option("--last <n>", "Number of messages to show", "20")
  .option("--thread <id>", "Show messages in a thread")
  .option("--room <id>", "Read from a specific room")
  .option("--no-verify", "Skip local signature verification")
  .action(async (opts) => {
    const config = loadConfig();
    const roomId = opts.room ?? config.default_room;

    if (!roomId) {
      console.error("No room selected. Run: chat join <room>");
      process.exit(1);
    }

    const api = new ApiClient(config);

    // Fetch participants for name resolution and key verification
    const participants = await api.get(`/rooms/${roomId}/participants`);
    const nameMap = new Map<string, string>();
    for (const p of participants.items) {
      nameMap.set(p.id, p.display_name);
    }

    // Cache public keys for verification
    const keyCache = new Map<string, string>();
    if (opts.verify !== false) {
      for (const p of participants.items) {
        try {
          const detail = await api.get(`/participants/${p.id}`);
          if (detail.key_history?.length > 0) {
            const activeKey = detail.key_history.find(
              (k: any) => k.valid_until === null,
            );
            if (activeKey) {
              keyCache.set(p.id, activeKey.public_key);

              // TOFU check
              const result = checkKey(p.id, activeKey.fingerprint);
              if (result === "changed") {
                console.error(
                  `\n  WARNING: Key changed for ${p.display_name} (${p.id})!`,
                );
                console.error(
                  `  New fingerprint: ${activeKey.fingerprint}`,
                );
                console.error(
                  "  This could indicate a key rotation or a compromise.\n",
                );
              }
            }
          }
        } catch {
          // Non-fatal — skip verification for this participant
        }
      }
    }

    const result = await api.get(
      `/rooms/${roomId}/messages?limit=${opts.last}${opts.thread ? `&thread_id=${opts.thread}` : ""}`,
    );

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

      // Local signature verification
      let sigStatus = "";
      if (opts.verify !== false && keyCache.has(msg.author_id)) {
        try {
          const signedPayload = {
            room_id: msg.room_id,
            content: { format: msg.content_format, text: msg.content_text },
            thread_id: msg.thread_id ?? null,
            mentions: [],
            attachments: [],
            nonce: msg.nonce,
            timestamp: msg.sender_timestamp,
          };
          const valid = await verify(
            keyCache.get(msg.author_id)!,
            signedPayload,
            msg.signature,
            msg.author_id,
          );
          sigStatus = valid ? " [verified]" : " [UNVERIFIED]";
        } catch {
          sigStatus = " [sig-error]";
        }
      }

      console.log(`[${time}] ${author}: ${msg.content_text}  (#${id})${sigStatus}`);
    }

    if (result.has_more) {
      console.log(`  ... more messages available (use --last to increase)`);
    }
  });
