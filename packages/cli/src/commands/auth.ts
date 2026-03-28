import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { sign } from "@chat-mcp/shared";
import { loadConfig, saveConfig } from "../config.js";
import { ApiClient } from "../api.js";

export const authCommand = new Command("auth")
  .description("Authentication commands");

authCommand
  .command("register")
  .description("Register a new participant")
  .requiredOption("--name <name>", "Display name")
  .option("--type <type>", "Participant type", "human")
  .option("--key <path>", "SSH public key path", "~/.ssh/id_ed25519.pub")
  .option("--paired-with <id>", "Paired human participant ID (for agents)")
  .action(async (opts) => {
    const config = loadConfig();
    const api = new ApiClient(config);

    const keyPath = opts.key.replace("~", homedir());
    const publicKey = readFileSync(resolve(keyPath), "utf-8").trim();
    const privateKeyPath = keyPath.replace(/\.pub$/, "");

    const result = await api.post("/auth/register", {
      display_name: opts.name,
      type: opts.type,
      public_key: publicKey,
      paired_with: opts.pairedWith ?? undefined,
    });

    config.participant_id = result.participant_id;
    config.ssh_key_path = privateKeyPath;
    saveConfig(config);

    console.log(`Registered as ${opts.name} (${result.participant_id})`);
    console.log("Authenticating...");

    // Auto-login
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
    saveConfig(config);

    console.log(`Authenticated. Token expires: ${session.expires_at}`);
  });

authCommand
  .command("login")
  .description("Authenticate with existing identity")
  .action(async () => {
    const config = loadConfig();
    if (!config.participant_id || !config.ssh_key_path) {
      console.error("Not registered. Run: chat auth register --name <name>");
      process.exit(1);
    }

    const api = new ApiClient(config);
    const challenge = await api.post("/auth/challenge", {
      participant_id: config.participant_id,
    });

    const signedChallenge = await sign(config.ssh_key_path, {
      challenge: challenge.challenge,
    });

    const session = await api.post("/auth/verify", {
      participant_id: config.participant_id,
      signed_challenge: signedChallenge,
    });

    config.session_token = session.session_token;
    saveConfig(config);

    console.log(`Authenticated. Token expires: ${session.expires_at}`);
  });
