#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync } from "fs";
import {
  ChatApiClient,
  loadPrivateKey,
  generateKeyPair,
} from "@chat-mcp/shared";
import { checkKey, listCachedKeys, acceptNewKey } from "./tofu-cache.js";
import { loadConfig, saveConfig, getConfigDir } from "./config.js";
import { join } from "path";

const program = new Command();

program
  .name("chat")
  .description("Chat MCP CLI - multi-agent collaborative chat")
  .version("0.1.0");

function createClient(): ChatApiClient {
  const config = loadConfig();
  let privateKey;
  if (config.private_key_path) {
    try {
      const pem = readFileSync(config.private_key_path, "utf-8");
      privateKey = loadPrivateKey(pem);
    } catch {
      // Key loading failed, proceed without signing
    }
  }
  return new ChatApiClient({
    serverUrl: config.server_url,
    participantId: config.participant_id,
    privateKey,
  });
}

// --- Config ---
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("show")
  .description("Show current config")
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

configCmd
  .command("set")
  .argument("<key>", "Config key (server_url, participant_id, private_key_path)")
  .argument("<value>", "Config value")
  .action((key: string, value: string) => {
    const config = loadConfig();
    (config as any)[key] = value;
    saveConfig(config);
    console.log(`Set ${key} = ${value}`);
  });

// --- Auth ---
const authCmd = program.command("auth").description("Authentication");

authCmd
  .command("keygen")
  .description("Generate a new Ed25519 keypair")
  .action(() => {
    const pair = generateKeyPair();
    const dir = getConfigDir();
    const { mkdirSync, writeFileSync } = require("fs");
    mkdirSync(dir, { recursive: true });
    const privPath = join(dir, "id_ed25519.pem");
    const pubPath = join(dir, "id_ed25519_pub.pem");
    writeFileSync(privPath, pair.privateKeyPem, { mode: 0o600 });
    writeFileSync(pubPath, pair.publicKeyPem);
    console.log(`Private key: ${privPath}`);
    console.log(`Public key:  ${pubPath}`);

    const config = loadConfig();
    config.private_key_path = privPath;
    saveConfig(config);
    console.log("Config updated with private_key_path");
  });

authCmd
  .command("register")
  .description("Register a new participant")
  .requiredOption("-n, --name <name>", "Display name")
  .option("-t, --type <type>", "Participant type (human|agent)", "human")
  .action(async (opts) => {
    const config = loadConfig();
    const pubKeyPath = join(getConfigDir(), "id_ed25519_pub.pem");
    let publicKeyPem: string;
    try {
      publicKeyPem = readFileSync(pubKeyPath, "utf-8");
    } catch {
      console.error("No public key found. Run: chat auth keygen");
      process.exit(1);
    }
    const client = createClient();
    const result = await client.register(opts.name, opts.type, publicKeyPem);
    config.participant_id = result.id;
    saveConfig(config);
    console.log(`Registered as ${result.display_name} (${result.id})`);
  });

authCmd
  .command("login")
  .description("Login with challenge-response")
  .action(async () => {
    const config = loadConfig();
    if (!config.participant_id || !config.private_key_path) {
      console.error("Must have participant_id and private_key_path configured. Run register first.");
      process.exit(1);
    }
    const client = createClient();
    const pem = readFileSync(config.private_key_path, "utf-8");
    const privateKey = loadPrivateKey(pem);
    const token = await client.login(config.participant_id, privateKey);
    console.log(`Logged in. Token: ${token.slice(0, 8)}...`);
  });

// --- Rooms ---
const roomCmd = program.command("room").description("Room management");

roomCmd
  .command("create")
  .argument("<name>", "Room name")
  .option("-p, --participants <ids...>", "Invite participant IDs")
  .action(async (name: string, opts) => {
    const client = createClient();
    const room = await client.createRoom(name, opts.participants);
    console.log(`Created room: ${room.name} (${room.id})`);
  });

roomCmd
  .command("list")
  .description("List rooms you belong to")
  .action(async () => {
    const client = createClient();
    const { data } = await client.listRooms();
    if (data.length === 0) {
      console.log("No rooms.");
      return;
    }
    for (const r of data) {
      console.log(`  ${r.name} (${r.id})${r.topic ? " - " + r.topic : ""}`);
    }
  });

roomCmd
  .command("info")
  .argument("<room-id>", "Room ID")
  .action(async (roomId: string) => {
    const client = createClient();
    const room = await client.getRoom(roomId);
    console.log(`Room: ${room.name}`);
    console.log(`ID: ${room.id}`);
    if (room.topic) console.log(`Topic: ${room.topic}`);
    console.log(`Participants: ${room.participants?.join(", ")}`);
  });

roomCmd
  .command("invite")
  .argument("<room-id>", "Room ID")
  .argument("<participant-id>", "Participant to invite")
  .action(async (roomId: string, participantId: string) => {
    const client = createClient();
    await client.invite(roomId, participantId);
    console.log("Invited.");
  });

roomCmd
  .command("topic")
  .argument("<room-id>", "Room ID")
  .argument("<topic>", "New topic")
  .action(async (roomId: string, topic: string) => {
    const client = createClient();
    await client.setTopic(roomId, topic);
    console.log("Topic set.");
  });

roomCmd
  .command("members")
  .argument("<room-id>", "Room ID")
  .action(async (roomId: string) => {
    const client = createClient();
    const { data } = await client.getParticipants(roomId);
    for (const m of data) {
      const status = m.status?.state || "unknown";
      console.log(`  ${m.display_name} (${m.id}) [${status}]`);
    }
  });

// --- Messages ---
const msgCmd = program.command("msg").description("Messages");

msgCmd
  .command("send")
  .argument("<room-id>", "Room ID")
  .argument("<text>", "Message text")
  .option("-t, --thread <thread-id>", "Reply to thread")
  .option("-m, --mention <ids...>", "Mention participant IDs")
  .action(async (roomId: string, text: string, opts) => {
    const client = createClient();
    const msg = await client.sendMessage(roomId, text, {
      thread_id: opts.thread,
      mentions: opts.mention,
    });
    console.log(`Sent: ${msg.id}`);
  });

msgCmd
  .command("read")
  .argument("<room-id>", "Room ID")
  .option("-n, --limit <n>", "Number of messages", "20")
  .option("-t, --thread <thread-id>", "Show thread")
  .action(async (roomId: string, opts) => {
    const client = createClient();
    const { data } = await client.getMessages(roomId, {
      limit: parseInt(opts.limit),
      thread_id: opts.thread,
    });
    // Display oldest first
    for (const m of [...data].reverse()) {
      const time = new Date(m.created_at).toLocaleTimeString();
      const edited = m.edited_at ? " (edited)" : "";
      const thread = m.thread_id ? ` [thread:${m.thread_id.slice(0, 8)}]` : "";
      console.log(`[${time}] ${m.author_id}: ${m.content.text}${edited}${thread}`);
      if (m.reactions?.length) {
        const rxns = m.reactions.map((r: any) => `${r.emoji}`).join(" ");
        console.log(`  reactions: ${rxns}`);
      }
    }
  });

msgCmd
  .command("search")
  .argument("<room-id>", "Room ID")
  .argument("<query>", "Search query")
  .action(async (roomId: string, query: string) => {
    const client = createClient();
    const { data } = await client.searchMessages(roomId, query);
    for (const m of data) {
      console.log(`  [${m.author_id}] ${m.content_text}`);
    }
  });

msgCmd
  .command("edit")
  .argument("<message-id>", "Message ID")
  .argument("<text>", "New text")
  .action(async (messageId: string, text: string) => {
    const client = createClient();
    await client.editMessage(messageId, text);
    console.log("Edited.");
  });

msgCmd
  .command("delete")
  .argument("<message-id>", "Message ID")
  .action(async (messageId: string) => {
    const client = createClient();
    await client.deleteMessage(messageId);
    console.log("Deleted.");
  });

// --- Reactions ---
msgCmd
  .command("react")
  .argument("<message-id>", "Message ID")
  .argument("<emoji>", "Emoji")
  .action(async (messageId: string, emoji: string) => {
    const client = createClient();
    await client.addReaction(messageId, emoji);
    console.log(`Reacted with ${emoji}`);
  });

msgCmd
  .command("unreact")
  .argument("<message-id>", "Message ID")
  .argument("<emoji>", "Emoji")
  .action(async (messageId: string, emoji: string) => {
    const client = createClient();
    await client.removeReaction(messageId, emoji);
    console.log("Removed reaction.");
  });

// --- Pins ---
msgCmd
  .command("pin")
  .argument("<message-id>", "Message ID")
  .action(async (messageId: string) => {
    const client = createClient();
    await client.pinMessage(messageId);
    console.log("Pinned.");
  });

msgCmd
  .command("unpin")
  .argument("<message-id>", "Message ID")
  .action(async (messageId: string) => {
    const client = createClient();
    await client.unpinMessage(messageId);
    console.log("Unpinned.");
  });

// --- Status ---
program
  .command("status")
  .description("Set your status")
  .argument("<state>", "Status state (online|busy|away|offline)")
  .option("-d, --description <desc>", "Status description")
  .action(async (state: string, opts) => {
    const client = createClient();
    await client.setStatus(state, opts.description);
    console.log(`Status set to ${state}`);
  });

// --- Watch (simple polling) ---
program
  .command("watch")
  .description("Watch a room for new events (polling)")
  .argument("<room-id>", "Room ID")
  .action(async (roomId: string) => {
    const client = createClient();
    let sinceSeq = 0;
    console.log(`Watching room ${roomId}... (Ctrl+C to stop)`);

    // Get initial sequence
    const initial = await client.getEvents(roomId, 0);
    if (initial.data.length) {
      sinceSeq = Math.max(...initial.data.map((e: any) => e.seq));
    }

    const poll = async () => {
      try {
        const { data } = await client.getEvents(roomId, sinceSeq);
        for (const event of data) {
          const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
          if (event.event_type === "message.created") {
            console.log(`[msg] ${payload.author_id}: ${payload.content?.text}`);
          } else {
            console.log(`[${event.event_type}] ${JSON.stringify(payload)}`);
          }
          sinceSeq = Math.max(sinceSeq, event.seq);
        }
      } catch (e: any) {
        if (e.code !== "ECONNREFUSED") console.error("Poll error:", e.message);
      }
    };

    setInterval(poll, 2000);
  });

// --- Keys (TOFU) ---
const keysCmd = program.command("keys").description("Manage trusted public keys (TOFU cache)");

keysCmd
  .command("list")
  .description("List all cached public keys")
  .action(() => {
    const keys = listCachedKeys();
    const entries = Object.entries(keys);
    if (entries.length === 0) {
      console.log("No cached keys.");
      return;
    }
    for (const [id, entry] of entries) {
      console.log(`  ${entry.displayName} (${id})`);
      console.log(`    Fingerprint: ${entry.fingerprint}`);
      console.log(`    First seen:  ${entry.firstSeen}`);
      console.log(`    Last seen:   ${entry.lastSeen}`);
    }
  });

keysCmd
  .command("check")
  .description("Check a participant's key against the TOFU cache")
  .argument("<participant-id>", "Participant ID")
  .action(async (participantId: string) => {
    const client = createClient();
    const participant = await client.getParticipant(participantId);
    if (!participant.public_key_pem) {
      console.log("Participant has no public key.");
      return;
    }
    const result = checkKey(participantId, participant.public_key_pem, participant.display_name);
    switch (result.status) {
      case "new":
        console.log(`New key cached for ${participant.display_name}`);
        console.log(`  Fingerprint: ${result.entry.fingerprint}`);
        break;
      case "trusted":
        console.log(`Key verified for ${participant.display_name} ✓`);
        console.log(`  Fingerprint: ${result.entry.fingerprint}`);
        break;
      case "changed":
        console.error(`⚠ KEY CHANGED for ${participant.display_name}!`);
        console.error(`  Previous: ${result.previousEntry.fingerprint}`);
        console.error(`  Current:  ${result.newFingerprint}`);
        console.error(`  This could indicate key rotation or impersonation.`);
        console.error(`  Run 'chat keys accept ${participantId}' to trust the new key.`);
        break;
    }
  });

keysCmd
  .command("accept")
  .description("Accept a changed key for a participant")
  .argument("<participant-id>", "Participant ID")
  .action(async (participantId: string) => {
    const client = createClient();
    const participant = await client.getParticipant(participantId);
    const entry = acceptNewKey(participantId, participant.public_key_pem, participant.display_name);
    console.log(`Accepted new key for ${participant.display_name}`);
    console.log(`  Fingerprint: ${entry.fingerprint}`);
  });

program.parse();
