import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { buildServer } from "../../src/server.js";
import { DASHBOARD_APP_URI } from "../../src/dashboard/app.js";

// MCP Apps: the dashboard view is declared as a ui:// resource and linked from the tool's _meta. The data
// payload (structuredContent) goes only to clients that advertise the extension; everyone else gets text.
async function connect(apps: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "scmcp-app-"));
  const config = loadConfig({ SC_DEMO: "true", SC_TOOLSETS: "default,reports", SC_DATA_DIR: dir, SC_EXPORT_DIR: join(dir, "exports") });
  const { server } = buildServer(config);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const capabilities = apps ? ({ extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } as Record<string, unknown>) : {};
  const client = new Client({ name: apps ? "apps-host" : "plain-host", version: "0" }, { capabilities });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("dashboard as an MCP App", () => {
  it("links the tool to the ui:// view and serves the view resource", async () => {
    const client = await connect(true);
    const tool = (await client.listTools()).tools.find((t) => t.name === "sc_build_dashboard")!;
    expect((tool._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(DASHBOARD_APP_URI);
    const res = await client.readResource({ uri: DASHBOARD_APP_URI });
    const view = res.contents[0] as { mimeType?: string; text?: string };
    expect(view.mimeType).toBe("text/html;profile=mcp-app");
    expect(view.text).toContain("ui/initialize");
    expect(view.text).not.toMatch(/https?:\/\/(?!app\.safetyculture\.com)/);
    await client.close();
  }, 60_000);

  it("sends the dashboard payload only to hosts that support MCP Apps", async () => {
    const apps = await connect(true);
    const withUi = (await apps.callTool({ name: "sc_build_dashboard", arguments: {} })) as { structuredContent?: { dashboard?: { fingerprint?: string } }; content: Array<{ text: string }> };
    expect(withUi.structuredContent?.dashboard?.fingerprint).toBeTruthy();
    expect(withUi.content[0]!.text).toContain("<untrusted-data>");
    await apps.close();

    const plain = await connect(false);
    const textOnly = (await plain.callTool({ name: "sc_build_dashboard", arguments: {} })) as { structuredContent?: unknown; content: Array<{ text: string }> };
    expect(textOnly.structuredContent).toBeUndefined();
    expect(textOnly.content[0]!.text).toContain("Saved to");
    await plain.close();
  }, 120_000);
});
