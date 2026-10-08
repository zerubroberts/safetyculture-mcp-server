import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Config } from "../../src/core/config.js";
import type { AnyToolSpec } from "../../src/core/registry.js";
import { buildServer } from "../../src/server.js";

export interface Recorded {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

type Handler = (req: Recorded) => unknown | Response | Promise<unknown | Response>;

/**
 * A fake Mitti API. Register routes as "METHOD /path" (exact path, query ignored) or with a
 * RegExp. Unmatched requests return 404 so tests fail loudly. All data must be synthetic.
 */
export class MockApi {
  readonly calls: Recorded[] = [];
  private routes: Array<{ method: string; match: string | RegExp; handler: Handler }> = [];

  on(route: string, handler: Handler | unknown): this {
    const [method, ...rest] = route.split(" ");
    const p = rest.join(" ");
    const match = p.startsWith("^") ? new RegExp(p) : p;
    this.routes.push({ method: method!.toUpperCase(), match, handler: typeof handler === "function" ? (handler as Handler) : () => handler });
    return this;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const req: Recorded = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };
    this.calls.push(req);
    const route = this.routes.find((r) => r.method === method && (typeof r.match === "string" ? r.match === url.pathname : r.match.test(url.pathname)));
    if (!route) return new Response(JSON.stringify({ message: `no mock for ${method} ${url.pathname}` }), { status: 404 });
    const out = await route.handler(req);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { "content-type": "application/json" } });
  };
}

export function testConfig(env: Record<string, string> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), "scmcp-"));
  return loadConfig({
    SC_API_TOKEN: "scapi_test_token_0000000000000000",
    SC_API_BASE_URL: "https://api.example.test",
    SC_DATA_DIR: dir,
    SC_TOOLSETS: "all",
    SC_REQUESTS_PER_SECOND: "1000",
    SC_MAX_RETRIES: "2",
    ...env,
  });
}

/** Spins up the real MCP server against the mock API and returns a connected MCP client. */
export async function connect(api: MockApi, env: Record<string, string> = {}, tools?: AnyToolSpec[]) {
  const config = testConfig(env);
  const { server } = buildServer(config, { fetch: api.fetch, tools });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    return { isError: Boolean(res.isError), text: res.content.map((c) => c.text).join("\n") };
  };
  /** Parses the JSON block of a tool result (works for plain and untrusted-wrapped output). */
  const json = (text: string) => {
    const inner = text.includes("<untrusted-data>") ? text.split("<untrusted-data>\n")[1]!.split("\n</untrusted-data>")[0]! : text.slice(text.indexOf("\n\n") + 2);
    return JSON.parse(inner.split("\n\nNote: output trimmed")[0]!);
  };
  return { client, call, json, config, close: () => client.close() };
}
