/**
 * Minimal MCP server implementation over stdio (JSON-RPC 2.0).
 * Avoids dependency on @modelcontextprotocol/sdk.
 */
import { createInterface } from "readline";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (args: any) => Promise<{ content: { type: string; text: string }[] }>;
}

export interface McpServerOptions {
  name: string;
  version: string;
  tools: McpTool[];
  instructions?: string;
}

export class McpServer {
  private tools: Map<string, McpTool>;
  private name: string;
  private version: string;
  private instructions?: string;
  private buffer = "";

  constructor(options: McpServerOptions) {
    this.name = options.name;
    this.version = options.version;
    this.tools = new Map(options.tools.map((t) => [t.name, t]));
    this.instructions = options.instructions;
  }

  async start() {
    const rl = createInterface({ input: process.stdin });

    rl.on("line", async (line: string) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        await this.handleMessage(msg);
      } catch (e: any) {
        this.sendError(null, -32700, "Parse error: " + e.message);
      }
    });

    // Keep process alive
    process.stdin.resume();
  }

  async handleMessage(msg: any) {
    const { id, method, params } = msg;

    switch (method) {
      case "initialize":
        this.sendResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: this.name,
            version: this.version,
          },
          instructions: this.instructions,
        });
        break;

      case "notifications/initialized":
        // No response needed for notifications
        break;

      case "tools/list":
        this.sendResult(id, {
          tools: Array.from(this.tools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
        break;

      case "tools/call": {
        const toolName = params?.name;
        const tool = this.tools.get(toolName);
        if (!tool) {
          this.sendResult(id, {
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            isError: true,
          });
          return;
        }
        try {
          const result = await tool.handler(params?.arguments || {});
          this.sendResult(id, result);
        } catch (e: any) {
          this.sendResult(id, {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          });
        }
        break;
      }

      case "ping":
        this.sendResult(id, {});
        break;

      default:
        if (id !== undefined) {
          this.sendError(id, -32601, `Method not found: ${method}`);
        }
    }
  }

  private send(msg: any) {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  private sendResult(id: any, result: any) {
    this.send({ jsonrpc: "2.0", id, result });
  }

  private sendError(id: any, code: number, message: string) {
    this.send({ jsonrpc: "2.0", id, error: { code, message } });
  }

  /** Send a notification (no id, no response expected) */
  sendNotification(method: string, params?: any) {
    this.send({ jsonrpc: "2.0", method, params });
  }
}
