import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = process.env.CHAT_MCP_CONFIG_DIR ?? join(homedir(), ".config", "chat-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface CliConfig {
  server_url: string;
  participant_id?: string;
  session_token?: string;
  ssh_key_path?: string;
  default_room?: string;
}

const DEFAULT_CONFIG: CliConfig = {
  server_url: "http://localhost:8808",
};

export function loadConfig(): CliConfig {
  let config = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_FILE)) {
    config = { ...config, ...JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) };
  }
  // Env vars override file config (useful for multi-session setups)
  if (process.env.CHAT_SERVER_URL) config.server_url = process.env.CHAT_SERVER_URL;
  if (process.env.CHAT_PARTICIPANT_ID) config.participant_id = process.env.CHAT_PARTICIPANT_ID;
  if (process.env.CHAT_SESSION_TOKEN) config.session_token = process.env.CHAT_SESSION_TOKEN;
  if (process.env.CHAT_SSH_KEY_PATH) config.ssh_key_path = process.env.CHAT_SSH_KEY_PATH;
  if (process.env.CHAT_DEFAULT_ROOM) config.default_room = process.env.CHAT_DEFAULT_ROOM;
  return config;
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
