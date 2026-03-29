import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BASE_DIR = join(homedir(), ".config", "chat-mcp");
const PROFILES_DIR = join(BASE_DIR, "profiles");

/**
 * Resolve which profile to use:
 *   CHAT_PROFILE=tim → ~/.config/chat-mcp/profiles/tim.json
 *   CHAT_MCP_CONFIG_DIR=... → legacy override
 *   neither → ~/.config/chat-mcp/config.json (default)
 */
function resolveConfigPath(): { dir: string; file: string } {
  if (process.env.CHAT_MCP_CONFIG_DIR) {
    const dir = process.env.CHAT_MCP_CONFIG_DIR;
    return { dir, file: join(dir, "config.json") };
  }
  if (process.env.CHAT_PROFILE) {
    return { dir: BASE_DIR, file: join(PROFILES_DIR, `${process.env.CHAT_PROFILE}.json`) };
  }
  return { dir: BASE_DIR, file: join(BASE_DIR, "config.json") };
}

const { dir: CONFIG_DIR, file: CONFIG_FILE } = resolveConfigPath();

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
  // Env vars override file config
  if (process.env.CHAT_SERVER_URL) config.server_url = process.env.CHAT_SERVER_URL;
  if (process.env.CHAT_PARTICIPANT_ID) config.participant_id = process.env.CHAT_PARTICIPANT_ID;
  if (process.env.CHAT_SESSION_TOKEN) config.session_token = process.env.CHAT_SESSION_TOKEN;
  if (process.env.CHAT_SSH_KEY_PATH) config.ssh_key_path = process.env.CHAT_SSH_KEY_PATH;
  if (process.env.CHAT_DEFAULT_ROOM) config.default_room = process.env.CHAT_DEFAULT_ROOM;
  return config;
}

export function saveConfig(config: CliConfig): void {
  if (process.env.CHAT_PROFILE) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  } else {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function listProfiles(): string[] {
  if (!existsSync(PROFILES_DIR)) return [];
  return readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
