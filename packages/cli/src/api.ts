import { PROTOCOL_VERSION } from "@chat-mcp/shared";
import type { CliConfig } from "./config.js";

export class ApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: CliConfig) {
    this.baseUrl = config.server_url;
    this.token = config.session_token;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Chat-Protocol-Version": String(PROTOCOL_VERSION),
      ...extra,
    };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  async get(path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      throw new Error(respBody.error?.message ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async patch(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      throw new Error(respBody.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async delete(path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      throw new Error(respBody.error?.message ?? `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}
