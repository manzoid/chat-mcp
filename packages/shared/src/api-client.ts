import { signData, loadPrivateKey, type KeyObject } from "./ssh-signing.js";
import { canonicalJsonHash } from "./canonical-json.js";
import { generateNonce } from "./ssh-signing.js";

export interface ChatClientConfig {
  serverUrl: string;
  participantId?: string;
  sessionToken?: string;
  privateKey?: KeyObject;
}

export class ChatApiClient {
  private config: ChatClientConfig;

  constructor(config: ChatClientConfig) {
    this.config = config;
  }

  setToken(token: string) {
    this.config.sessionToken = token;
  }

  setParticipantId(id: string) {
    this.config.participantId = id;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.sessionToken) {
      h["Authorization"] = `Bearer ${this.config.sessionToken}`;
    }
    if (this.config.participantId) {
      h["X-Participant-Id"] = this.config.participantId;
    }
    return h;
  }

  private async fetch(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.config.serverUrl}${path}`;
    const init: RequestInit = { method, headers: this.headers() };
    if (body) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(res.status, data.error?.code || "unknown", data.error?.message || "Request failed");
    }
    return data;
  }

  // --- Auth ---
  async register(displayName: string, type: "human" | "agent", publicKeyPem: string, opts?: { paired_with?: string; github_username?: string }) {
    return this.fetch("POST", "/auth/register", {
      display_name: displayName,
      type,
      public_key_pem: publicKeyPem,
      ...opts,
    });
  }

  async login(participantId: string, privateKey: KeyObject): Promise<string> {
    const { challenge } = await this.fetch("POST", "/auth/challenge", { participant_id: participantId });
    const signed = signData(privateKey, Buffer.from(challenge));
    const { session_token } = await this.fetch("POST", "/auth/verify", {
      participant_id: participantId,
      signed_challenge: signed,
    });
    this.setToken(session_token);
    this.setParticipantId(participantId);
    return session_token;
  }

  // --- Rooms ---
  async createRoom(name: string, participants?: string[]) {
    return this.fetch("POST", "/rooms", { name, participants });
  }

  async listRooms() {
    return this.fetch("GET", "/rooms");
  }

  async getRoom(roomId: string) {
    return this.fetch("GET", `/rooms/${roomId}`);
  }

  async invite(roomId: string, participantId: string) {
    return this.fetch("POST", `/rooms/${roomId}/invite`, { participant_id: participantId });
  }

  async kick(roomId: string, participantId: string) {
    return this.fetch("POST", `/rooms/${roomId}/kick`, { participant_id: participantId });
  }

  async setTopic(roomId: string, topic: string) {
    return this.fetch("PUT", `/rooms/${roomId}/topic`, { topic });
  }

  async getParticipants(roomId: string) {
    return this.fetch("GET", `/rooms/${roomId}/participants`);
  }

  // --- Messages ---
  async sendMessage(roomId: string, text: string, opts?: {
    format?: string;
    thread_id?: string;
    mentions?: string[];
    attachments?: string[];
  }) {
    const content = { format: opts?.format || "markdown", text };
    const nonce = generateNonce();
    const timestamp = new Date().toISOString();

    let signature = "unsigned";
    if (this.config.privateKey) {
      const payload = {
        room_id: roomId,
        content,
        thread_id: opts?.thread_id ?? null,
        mentions: opts?.mentions ?? [],
        attachments: opts?.attachments ?? [],
        timestamp,
        nonce,
      };
      const hash = canonicalJsonHash(payload);
      signature = signData(this.config.privateKey, hash);
    }

    return this.fetch("POST", `/rooms/${roomId}/messages`, {
      content,
      thread_id: opts?.thread_id,
      mentions: opts?.mentions,
      attachments: opts?.attachments,
      signature,
      nonce,
      timestamp,
    });
  }

  async getMessages(roomId: string, opts?: { limit?: number; before?: string; thread_id?: string }) {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", opts.before);
    if (opts?.thread_id) params.set("thread_id", opts.thread_id);
    const qs = params.toString();
    return this.fetch("GET", `/rooms/${roomId}/messages${qs ? "?" + qs : ""}`);
  }

  async searchMessages(roomId: string, query: string) {
    return this.fetch("GET", `/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`);
  }

  async editMessage(messageId: string, text: string, format?: string) {
    const content = { format: format || "markdown", text };
    let signature = "unsigned";
    if (this.config.privateKey) {
      const payload = { message_id: messageId, content, timestamp: new Date().toISOString() };
      const hash = canonicalJsonHash(payload);
      signature = signData(this.config.privateKey, hash);
    }
    return this.fetch("PATCH", `/messages/${messageId}`, { content, signature });
  }

  async deleteMessage(messageId: string) {
    return this.fetch("DELETE", `/messages/${messageId}`);
  }

  // --- Reactions ---
  async addReaction(messageId: string, emoji: string) {
    let signature = "unsigned";
    if (this.config.privateKey && this.config.participantId) {
      const payload = { message_id: messageId, emoji, author_id: this.config.participantId };
      const hash = canonicalJsonHash(payload);
      signature = signData(this.config.privateKey, hash);
    }
    return this.fetch("POST", `/messages/${messageId}/reactions`, { emoji, signature });
  }

  async removeReaction(messageId: string, emoji: string) {
    return this.fetch("DELETE", `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  }

  // --- Pins ---
  async pinMessage(messageId: string) {
    return this.fetch("POST", `/messages/${messageId}/pin`);
  }

  async unpinMessage(messageId: string) {
    return this.fetch("DELETE", `/messages/${messageId}/pin`);
  }

  async getPins(roomId: string) {
    return this.fetch("GET", `/rooms/${roomId}/pins`);
  }

  // --- Status ---
  async setStatus(state: string, description?: string) {
    return this.fetch("POST", "/participants/me/status", { state, description });
  }

  async getParticipant(id: string) {
    return this.fetch("GET", `/participants/${id}`);
  }

  // --- Events ---
  async getEvents(roomId: string, sinceSeq: number = 0) {
    return this.fetch("GET", `/rooms/${roomId}/events?since_seq=${sinceSeq}`);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
