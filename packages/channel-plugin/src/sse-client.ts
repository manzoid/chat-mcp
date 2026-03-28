/**
 * Simple SSE client that connects to the chat server's event stream.
 */
export type SSECallback = (event: any) => void;

export class SSEClient {
  private controller: AbortController | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;

  constructor(
    private url: string,
    private headers: Record<string, string>,
    private onEvent: SSECallback,
    private onError?: (error: Error) => void
  ) {}

  async connect(): Promise<void> {
    this.controller = new AbortController();
    try {
      const res = await fetch(this.url, {
        headers: this.headers,
        signal: this.controller.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE connection failed: ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      this.reconnectDelay = 1000; // Reset on successful connect
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              this.onEvent(data);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      this.onError?.(e);
    }

    // Auto-reconnect if not explicitly disconnected
    if (this.controller && !this.controller.signal.aborted) {
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }
  }

  disconnect() {
    this.controller?.abort();
    this.controller = null;
  }
}
