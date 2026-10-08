import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./core/registry.js";
import { TOOLSETS } from "./core/registry.js";
import { SAFETY_MODEL } from "./docs-inline.js";

/** Static, always-safe resources. Data resources (exports, cache schema) are added by their toolsets. */
export function registerResources(server: McpServer, ctx: ToolContext) {
  server.registerResource(
    "server-info",
    "sc://server/info",
    { title: "Server configuration", description: "Mode, privacy level and toolsets of this server (no secrets).", mimeType: "application/json" },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            { mode: ctx.config.mode, pii: ctx.config.pii, toolsets: ctx.config.toolsets, available_toolsets: TOOLSETS, api_base_url: ctx.config.baseUrl },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "safety-model",
    "sc://guide/safety-model",
    { title: "How this server protects your data", description: "Read-only default, write gating, dry-run confirmation, redaction, audit log.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: SAFETY_MODEL }] }),
  );
}
