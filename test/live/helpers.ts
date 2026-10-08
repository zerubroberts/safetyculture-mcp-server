import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.js";
import { buildServer } from "../../src/server.js";

/**
 * Live harness: runs the real server against the real Mitti API with SC_API_TOKEN.
 * Rules: assertions use counts and shapes only, and nothing here may print record contents.
 */
export const LIVE_TOKEN = process.env.SC_API_TOKEN ?? process.env.SAFETYCULTURE_API_TOKEN;
export const LIVE_WRITES = /^(1|true)$/i.test(process.env.SC_LIVE_WRITE_TESTS ?? "");
export const TEST_PREFIX = "[mcp-test]";

export async function liveClient(mode: "read-only" | "write" | "full" = "read-only") {
  const config = loadConfig({
    SC_API_TOKEN: LIVE_TOKEN,
    SC_MODE: mode,
    SC_TOOLSETS: "all",
    SC_DATA_DIR: mkdtempSync(join(tmpdir(), "scmcp-live-")),
    SC_PII: "strict",
  });
  const { server } = buildServer(config);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "live-test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content.map((c) => c.text).join("\n");
    return { isError: Boolean(res.isError), text, data: parse(text) };
  };
  return { client, call, close: () => client.close() };
}

function parse(text: string): any {
  try {
    const body = text.split("\n\nNote: output trimmed")[0]!;
    const inner = body.includes("<untrusted-data>") ? body.split("<untrusted-data>\n")[1]!.split("\n</untrusted-data>")[0]! : body;
    return JSON.parse(inner.split("\n").pop()!);
  } catch {
    return undefined;
  }
}

/** Short, content-free description of a tool result for logs: never record values. */
export const shape = (r: { isError: boolean; text: string }) => `${r.isError ? "ERROR" : "ok"} (${r.text.length} chars)`;
