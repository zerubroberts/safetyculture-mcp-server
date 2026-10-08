import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderDashboardHtml } from "./html.js";

/**
 * MCP Apps (extension io.modelcontextprotocol/ui, spec 2026-01-26): hosts that support it render a tool's
 * result inline with an HTML "view" the server declares as a ui:// resource. The view here is the same
 * dashboard page with no data baked in; its script performs the ui/initialize handshake with the host and
 * draws the dashboard from the tool result's structuredContent.dashboard.
 *
 * Needs no new dependency: the resource is a plain registerResource() call and the tool link is
 * `_meta.ui.resourceUri` on the tool definition. Wiring it in touches orchestrator-owned files (the tool
 * registry must pass `_meta` and `structuredContent` through); see RESULT.md for the exact change.
 */

export const DASHBOARD_APP_URI = "ui://safetyculture-mcp/dashboard";
export { MCP_APP_MIME as DASHBOARD_APP_MIME } from "../core/registry.js";
import { MCP_APP_MIME as DASHBOARD_APP_MIME } from "../core/registry.js";

/** `_meta` for the sc_build_dashboard tool definition, linking it to the view. */
export const DASHBOARD_TOOL_META = { ui: { resourceUri: DASHBOARD_APP_URI } } as const;

/** The view template: the dashboard shell and renderer without data. */
export function dashboardAppHtml(): string {
  return renderDashboardHtml(null);
}

/** Registers the ui:// view resource. The view makes no network requests, so it declares no CSP domains. */
export function registerDashboardApp(server: McpServer): void {
  server.registerResource(
    "safety-dashboard-view",
    DASHBOARD_APP_URI,
    {
      title: "Safety dashboard (inline view)",
      description: "Interactive dashboard view for sc_build_dashboard results, for MCP clients that support MCP Apps.",
      mimeType: DASHBOARD_APP_MIME,
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: DASHBOARD_APP_MIME, text: dashboardAppHtml(), _meta: { ui: { prefersBorder: false } } }] }),
  );
}
