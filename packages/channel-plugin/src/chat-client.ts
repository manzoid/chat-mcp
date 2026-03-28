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

  async authenticate(): Promise<void> {
    // Request challenge
    const chalRes = await fetch(`${this.config.serverUrl}/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participant_id: this.config.participantId }),
    });
    if (!chalRes.ok) throw new Error("Challenge request failed");
    const { challenge } = await chalRes.json();

    // Sign challenge
    const signedChallenge = await sign(this.config.sshKeyPath, { challenge });

    // Verify
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

  async sendMessage(
    roomId: string,
    text: string,
    threadId?: string,
  ): Promise<any> {
    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const content = { format: "plain" as const, text };
    const payload = {
      room_id: roomId,
      content,
      thread_id: threadId ?? null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(this.config.sshKeyPath, payload);

    const res = await fetch(
      `${this.config.serverUrl}/rooms/${roomId}/messages`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          content,
          thread_id: threadId,
          mentions: [],
          attachments: [],
          nonce,
          timestamp,
          signature,
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async addReaction(messageId: string, emoji: string): Promise<void> {
    const reactionPayload = {
      message_id: messageId,
      emoji,
      author_id: this.config.participantId,
    };
    const signature = await sign(this.config.sshKeyPath, reactionPayload);

    const res = await fetch(
      `${this.config.serverUrl}/messages/${messageId}/reactions`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ emoji, signature }),
      },
    );
    if (!res.ok) throw new Error(`Reaction failed: HTTP ${res.status}`);
  }

  async getHistory(
    roomId: string,
    cursor?: string,
    limit = 20,
  ): Promise<any> {
    let url = `${this.config.serverUrl}/rooms/${roomId}/messages?limit=${limit}`;
    if (cursor) url += `&cursor=${cursor}`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`History failed: HTTP ${res.status}`);
    return res.json();
  }

  async search(
    query: string,
    roomId?: string,
    author?: string,
  ): Promise<any> {
    if (!roomId) throw new Error("Room ID required for search");
    let url = `${this.config.serverUrl}/rooms/${roomId}/messages/search?q=${encodeURIComponent(query)}`;
    if (author) url += `&author=${author}`;

    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
    return res.json();
  }

  async getThread(messageId: string): Promise<any> {
    const res = await fetch(
      `${this.config.serverUrl}/messages/${messageId}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Thread failed: HTTP ${res.status}`);
    return res.json();
  }

  async pinMessage(messageId: string): Promise<void> {
    const res = await fetch(
      `${this.config.serverUrl}/messages/${messageId}/pin`,
      {
        method: "POST",
        headers: this.headers(),
        body: "{}",
      },
    );
    if (!res.ok) throw new Error(`Pin failed: HTTP ${res.status}`);
  }

  async editMessage(messageId: string, text: string): Promise<void> {
    // Fetch original message to get room_id
    const msgRes = await fetch(
      `${this.config.serverUrl}/messages/${messageId}`,
      { headers: this.headers() },
    );
    if (!msgRes.ok) throw new Error(`Fetch message failed`);
    const msg = await msgRes.json();

    const nonce = uuid();
    const timestamp = new Date().toISOString();
    const content = { format: "plain" as const, text };
    const payload = {
      room_id: msg.room_id,
      content,
      thread_id: null,
      mentions: [],
      attachments: [],
      nonce,
      timestamp,
    };
    const signature = await sign(this.config.sshKeyPath, payload);

    const res = await fetch(
      `${this.config.serverUrl}/messages/${messageId}`,
      {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ content, nonce, signature, timestamp }),
      },
    );
    if (!res.ok) throw new Error(`Edit failed: HTTP ${res.status}`);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const res = await fetch(
      `${this.config.serverUrl}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: this.headers(),
        body: "{}",
      },
    );
    if (!res.ok) throw new Error(`Delete failed: HTTP ${res.status}`);
  }

  async setStatus(state: string, description?: string): Promise<void> {
    const res = await fetch(
      `${this.config.serverUrl}/participants/me/status`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ state, description }),
      },
    );
    // Status endpoint might not exist yet — non-fatal
    if (!res.ok && res.status !== 404) {
      throw new Error(`Status update failed: HTTP ${res.status}`);
    }
  }

  /**
   * Connect to the SSE event stream for a room.
   * Returns an async iterator of events.
   */
  async *subscribeEvents(
    roomId: string,
    sinceSeq = 0,
  ): AsyncGenerator<{ event: string; data: string; id?: string }> {
    const url = `${this.config.serverUrl}/rooms/${roomId}/events/stream`;
    const res = await fetch(url, {
      headers: {
        ...this.headers(),
        Accept: "text/event-stream",
        ...(sinceSeq > 0 && { "Last-Event-ID": String(sinceSeq) }),
      },
    });

    if (!res.ok) {
      throw new Error(`SSE connection failed: HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

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
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        } else if (line.startsWith("id:")) {
          currentId = line.slice(3).trim();
        } else if (line === "" && currentData) {
          yield { event: currentEvent, data: currentData, id: currentId };
          currentEvent = "";
          currentData = "";
          currentId = "";
        }
      }
    }
  }
}
