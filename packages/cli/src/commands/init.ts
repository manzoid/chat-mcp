import { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { sign } from "@chat-mcp/shared";
import { saveConfig } from "../config.js";
import { ApiClient } from "../api.js";
import type { CliConfig } from "../config.js";

export const initCommand = new Command("init")
  .description("Set up this machine — register with a server and create a profile")
  .argument("<server-url>", "Chat server URL (e.g. http://localhost:8808)")
  .requiredOption("--invite <token>", "Invite token or URL (get this from your admin)")
  .requiredOption("--name <name>", "Your display name")
  .option("--key <path>", "SSH public key path", "~/.ssh/id_ed25519.pub")
  .action(async (serverUrl, opts) => {
    // Normalize server URL
    serverUrl = serverUrl.replace(/\/$/, "");

    // Resolve SSH key
    const keyPath = opts.key.replace("~", homedir());
    const resolvedKeyPath = resolve(keyPath);
    if (!existsSync(resolvedKeyPath)) {
      console.error(`SSH public key not found: ${resolvedKeyPath}`);
      console.error("Generate one with: ssh-keygen -t ed25519");
      process.exit(1);
    }
    const publicKey = readFileSync(resolvedKeyPath, "utf-8").trim();
    const privateKeyPath = resolvedKeyPath.replace(/\.pub$/, "");

    // Extract invite ID from URL or bare token
    const inviteId = opts.invite.includes("/")
      ? opts.invite.split("/").pop()
      : opts.invite;

    // Build a temporary config pointing at the server
    const config: CliConfig = { server_url: serverUrl };
    const api = new ApiClient(config);

    // Check server is reachable
    try {
      await api.get("/health");
    } catch {
      console.error(`Cannot reach server at ${serverUrl}`);
      process.exit(1);
    }

    // Register via invite
    console.log(`Registering as ${opts.name} on ${serverUrl}...`);
    let result: any;
    try {
      result = await api.post(`/auth/invite/${inviteId}`, {
        display_name: opts.name,
        type: "human",
        public_key: publicKey,
      });
    } catch (e: any) {
      console.error(`Registration failed: ${e.message}`);
      process.exit(1);
    }

    config.participant_id = result.participant_id;
    config.ssh_key_path = privateKeyPath;
    if (result.rooms_joined?.length) {
      config.default_room = result.rooms_joined[0];
    }

    // Auto-login
    console.log("Authenticating...");
    const challenge = await api.post("/auth/challenge", {
      participant_id: result.participant_id,
    });
    const signedChallenge = await sign(privateKeyPath, {
      challenge: challenge.challenge,
    });
    const session = await api.post("/auth/verify", {
      participant_id: result.participant_id,
      signed_challenge: signedChallenge,
    });

    config.session_token = session.session_token;

    // Save profile using CHAT_PROFILE env or default
    const profileName = process.env.CHAT_PROFILE || opts.name;
    process.env.CHAT_PROFILE = profileName;
    saveConfig(config);

    console.log(`\nDone! Profile saved as "${profileName}".`);
    console.log(`\nTo chat:  CHAT_PROFILE=${profileName} chat tui`);
    console.log(`To agent: bin/chat-agent ${profileName} A .`);
  });
