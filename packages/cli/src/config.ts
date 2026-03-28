import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface CliConfig {
  server_url: string;
  participant_id?: string;
  private_key_path?: string;
}

const CONFIG_DIR = join(homedir(), ".config", "chat-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { server_url: "http://localhost:8080" };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
