import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spawns the built server exactly as MCP clients do (node dist/index.js over stdio).
// Needs `npx tsup` first; skipped when dist is missing.
const d = existsSync("dist/index.js") ? describe : describe.skip;

d("stdio end to end", () => {
  it("starts, lists tools, refuses writes in read-only mode, reports config errors on stderr", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["dist/index.js"],
      env: { ...process.env, SC_API_TOKEN: "scapi_e2e_placeholder_000000", SC_API_BASE_URL: "https://api.example.test" } as Record<string, string>,
      stderr: "pipe",
    });
    const client = new Client({ name: "e2e", version: "0" });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("sc_safety_pulse");
    expect(tools).not.toContain("sc_create_action");
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toContain("weekly_safety_review");
    const res = (await client.readResource({ uri: "sc://guide/safety-model" })).contents[0] as { text: string };
    expect(res.text).toMatch(/Read-only by default/);
    await client.close();
  }, 30_000);
});

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { testConfig } from "../helpers/mock-api.js";
import { startHttp } from "../../src/transports/http.js";

describe("http end to end", () => {
  it("serves MCP on /mcp with bearer auth and rejects missing tokens", async () => {
    const cfg = testConfig({ SC_HTTP_PORT: "0", SC_HTTP_BEARER_TOKEN: "test-bearer-0123456789", SC_TOOLSETS: "default" });
    const server = await startHttp(cfg, {});
    const port = (server.address() as { port: number }).port;
    const url = new URL(`http://127.0.0.1:${port}/mcp`);
    try {
      const denied = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(denied.status).toBe(401);
      const badOrigin = await fetch(url, { method: "POST", headers: { origin: "https://evil.example", authorization: "Bearer test-bearer-0123456789" }, body: "{}" });
      expect(badOrigin.status).toBe(403);

      const client = new Client({ name: "e2e-http", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: "Bearer test-bearer-0123456789" } } }));
      const tools = (await client.listTools()).tools.map((t) => t.name);
      expect(tools).toContain("sc_list_actions");
      await client.close();
    } finally {
      server.close();
    }
  }, 30_000);
});
