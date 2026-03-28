import { PROTOCOL_VERSION, sign } from "@chat-mcp/shared";
import { v4 as uuid } from "uuid";

export interface ChatClientConfig {
  serverUrl: string;
  participantId: string;
  sshKeyPath: string;
  sessionToken?: string;
}

export class ChatClient {
  private token?: string;

  constructor(private config: ChatClientConfig) {
    this.token = config.sessionToken;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Chat-Protocol-Version": String(PROTOCOL_VERSION),
    };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * Fetch with automatic token refresh on 401.
   */
  private async authedFetch(url: string, init?: RequestInit): Promise<Response> {
    const makeRequest = () =>
      fetch(url, { ...init, headers: { ...this.headers(), ...(init?.headers as Record<string, string> ?? {}) } });

    const res = await makeRequest();
    if (res.status === 401) {
      await this.authenticate();
      return makeRequest();
    }
    return res;
  }

  async authenticate(): Promise<void> {
    const chalRes = await fetch(`${this.config.serverUrl}/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: this.config.participantId }),
    });
    if (!chalRes.ok) throw new Error("Challenge request failed");
    const { challenge } = await chalRes.json();

    const signedChallenge = await sign(this.config.sshKeyPath, { challenge });

    const verRes = await fetch(`${this.config.serverUrl}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: this.config.participantId,
        signed_challenge: signedChallenge,
      }),
    });
    if (!verRes.ok) throw new Error("Verification failed");
    const { session_token } = await verRes.json();
    this.token = session_token;
  }

  async sendMessage(roomId: string, text: string, threadId?: string): Promise<any> {
    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const content = { format: "plain" as const, text };
    const payload = {
      room_id: roomId, content, thread_id: threadId ?? null,
      mentions: [], attachments: [], nonce, timestamp,
    };
    const signature = await sign(this.config.sshKeyPath, payload);

    const res = await this.authedFetch(`${this.config.serverUrl}/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, thread_id: threadId, mentions: [], attachments: [], nonce, timestamp, signature }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? `HTTP ${res.status}`);
    return res.json();
  }

  async addReaction(messageId: string, emoji: string): Promise<void> {
    const sig = await sign(this.config.sshKeyPath, {
      message_id: messageId, emoji, author_id: this.config.participantId,
    });
    const res = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji, signature: sig }),
    });
    if (!res.ok) throw new Error(`Reaction failed: HTTP ${res.status}`);
  }

  async getHistory(roomId: string, cursor?: string, limit = 20): Promise<any> {
    let url = `${this.config.serverUrl}/rooms/${roomId}/messages?limit=${limit}`;
    if (cursor) url += `&cursor=${cursor}`;
    const res = await this.authedFetch(url);
    if (!res.ok) throw new Error(`History failed: HTTP ${res.status}`);
    return res.json();
  }

  async search(query: string, roomId?: string, author?: string): Promise<any> {
    if (!roomId) throw new Error("Room ID required for search");
    let url = `${this.config.serverUrl}/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`;
    if (author) url += `&author=${author}`;
    const res = await this.authedFetch(url);
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    return res.json();
  }

  async getThread(messageId: string): Promise<any> {
    const res = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}`);
    if (!res.ok) throw new Error(`Thread failed: HTTP ${res.status}`);
    return res.json();
  }

  async pinMessage(messageId: string): Promise<void> {
    const res = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}/pin`, {
      method: "POST", body: "{}",
    });
    if (!res.ok) throw new Error(`Pin failed: HTTP ${res.status}`);
  }

  async editMessage(messageId: string, text: string): Promise<void> {
    const msgRes = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}`);
    if (!msgRes.ok) throw new Error("Fetch message failed");
    const msg = await msgRes.json();

    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const content = { format: "plain" as const, text };
    const payload = {
      room_id: msg.room_id, content, thread_id: null,
      mentions: [], attachments: [], nonce, timestamp,
    };
    const signature = await sign(this.config.sshKeyPath, payload);

    const res = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content, nonce, signature, timestamp }),
    });
    if (!res.ok) throw new Error(`Edit failed: HTTP ${res.status}`);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const res = await this.authedFetch(`${this.config.serverUrl}/messages/${messageId}`, {
      method: "DELETE", body: "{}",
    });
    if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
  }

  async setStatus(state: string, description?: string): Promise<void> {
    const res = await this.authedFetch(`${this.config.serverUrl}/participants/me/status`, {
      method: "POST",
      body: JSON.stringify({ state, description }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`Status update failed: HTTP ${res.status}`);
  }

  /**
   * Connect to the SSE event stream with automatic reconnection.
   */
  async *subscribeEvents(roomId: string, sinceSeq = 0): AsyncGenerator<{ event: string; data: string; id?: string }> {
    let lastSeq = sinceSeq;
    let retryDelay = 1000;
    const maxDelay = 30000;

    while (true) {
      try {
        const url = `${this.config.serverUrl}/rooms/${roomId}/events/stream`;
        const res = await this.authedFetch(url, {
          headers: {
            Accept: "text/event-stream",
            ...(lastSeq > 0 && { "Last-Event-ID": String(lastSeq) }),
          },
        });

        if (!res.ok) throw new Error(`SSE connection failed: HTTP ${res.status}`);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        retryDelay = 1000; // Reset on successful connect
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";
        let currentData = "";
        let currentId = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
            else if (line.startsWith("data:")) currentData = line.slice(5).trim();
            else if (line.startsWith("id:")) currentId = line.slice(3).trim();
            else if (line === "" && currentData) {
              if (currentId) lastSeq = parseInt(currentId);
              yield { event: currentEvent, data: currentData, id: currentId };
              currentEvent = "";
              currentData = "";
              currentId = "";
            }
          }
        }
      } catch {
        // Reconnect with exponential backoff + jitter
        const jitter = Math.random() * 1000;
        await new Promise((r) => setTimeout(r, retryDelay + jitter));
        retryDelay = Math.min(retryDelay * 2, maxDelay);
      }
    }
  }
}
