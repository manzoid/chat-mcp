import { describe, test, expect, beforeEach } from "bun:test";
import { McpServer, type McpTool } from "../src/mcp-server";

function createTestServer(tools: McpTool[] = [], instructions?: string) {
  const outputs: any[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);

  const server = new McpServer({
    name: "test-server",
    version: "0.1.0",
    tools,
    instructions,
  });

  const capture = () => {
    process.stdout.write = ((data: any) => {
      const str = typeof data === "string" ? data : data.toString();
      try {
        outputs.push(JSON.parse(str.trim()));
      } catch {}
      return true;
    }) as any;
  };

  const restore = () => {
    process.stdout.write = origWrite;
  };

  return { server, outputs, capture, restore };
}

describe("McpServer", () => {
  test("initialize returns server info, capabilities, and instructions", async () => {
    const { server, outputs, capture, restore } = createTestServer([], "Trust humans only.");
    capture();
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    restore();

    expect(outputs.length).toBe(1);
    const result = outputs[0].result;
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo.name).toBe("test-server");
    expect(result.serverInfo.version).toBe("0.1.0");
    expect(result.capabilities.tools).toEqual({});
    expect(result.instructions).toBe("Trust humans only.");
  });

  test("initialize without instructions omits the field", async () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    restore();

    expect(outputs[0].result.instructions).toBeUndefined();
  });

  test("tools/list returns all registered tools", async () => {
    const tools: McpTool[] = [
      {
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        handler: async (args) => ({ content: [{ type: "text", text: args.text }] }),
      },
      {
        name: "greet",
        description: "Greet someone",
        inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
        handler: async (args) => ({ content: [{ type: "text", text: `Hello ${args.name}` }] }),
      },
    ];

    const { server, outputs, capture, restore } = createTestServer(tools);
    capture();
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    restore();

    expect(outputs.length).toBe(1);
    const toolList = outputs[0].result.tools;
    expect(toolList.length).toBe(2);
    expect(toolList[0].name).toBe("echo");
    expect(toolList[1].name).toBe("greet");
    // Handlers should not be exposed
    expect(toolList[0].handler).toBeUndefined();
  });

  test("tools/call invokes handler and returns result", async () => {
    const tools: McpTool[] = [
      {
        name: "add",
        description: "Add two numbers",
        inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
        handler: async (args) => ({ content: [{ type: "text", text: String(args.a + args.b) }] }),
      },
    ];

    const { server, outputs, capture, restore } = createTestServer(tools);
    capture();
    await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "add", arguments: { a: 3, b: 4 } },
    });
    restore();

    expect(outputs[0].result.content[0].text).toBe("7");
  });

  test("tools/call with unknown tool returns error result", async () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nonexistent", arguments: {} },
    });
    restore();

    expect(outputs[0].result.isError).toBe(true);
    expect(outputs[0].result.content[0].text).toContain("Unknown tool");
  });

  test("tools/call handler error returns error result", async () => {
    const tools: McpTool[] = [
      {
        name: "fail",
        description: "Always fails",
        inputSchema: { type: "object", properties: {} },
        handler: async () => { throw new Error("something broke"); },
      },
    ];

    const { server, outputs, capture, restore } = createTestServer(tools);
    capture();
    await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "fail", arguments: {} },
    });
    restore();

    expect(outputs[0].result.isError).toBe(true);
    expect(outputs[0].result.content[0].text).toContain("something broke");
  });

  test("ping returns empty result", async () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    await server.handleMessage({ jsonrpc: "2.0", id: 5, method: "ping", params: {} });
    restore();

    expect(outputs[0].id).toBe(5);
    expect(outputs[0].result).toEqual({});
  });

  test("unknown method returns method not found error", async () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    await server.handleMessage({ jsonrpc: "2.0", id: 6, method: "unknown/method", params: {} });
    restore();

    expect(outputs[0].error.code).toBe(-32601);
    expect(outputs[0].error.message).toContain("Method not found");
  });

  test("notification (no id) for unknown method does not send error", async () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    restore();

    // notifications/initialized is handled silently
    expect(outputs.length).toBe(0);
  });

  test("sendNotification sends correct format", () => {
    const { server, outputs, capture, restore } = createTestServer();
    capture();
    server.sendNotification("notifications/message", { level: "info", data: "hello" });
    restore();

    expect(outputs.length).toBe(1);
    expect(outputs[0].jsonrpc).toBe("2.0");
    expect(outputs[0].method).toBe("notifications/message");
    expect(outputs[0].params.data).toBe("hello");
    expect(outputs[0].id).toBeUndefined();
  });
});
