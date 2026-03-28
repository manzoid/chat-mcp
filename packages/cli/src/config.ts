import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "chat-mcp");
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
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = readFileSync(CONFIG_FILE, "utf-8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}
