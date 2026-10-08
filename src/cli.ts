import { createHash } from "node:crypto";
import { ScClient } from "./core/client.js";
import { loadConfig } from "./core/config.js";
import { selectTools, TOOLSETS } from "./core/registry.js";
import { ALL_TOOLS } from "./toolsets/index.js";
import { VERSION } from "./version.js";

const out = (s = "") => process.stdout.write(s + "\n");

const HELP = `safetyculture-mcp ${VERSION}: MCP server for Mitti (formerly SafetyCulture)

Usage:
  safetyculture-mcp                 Start on stdio (what Claude, Codex, Cursor and VS Code launch)
  safetyculture-mcp http            Start the Streamable HTTP transport on 127.0.0.1:8787/mcp
  safetyculture-mcp doctor          Check the token, API reachability and what will be exposed
  safetyculture-mcp tools           List the tools this config would expose
  safetyculture-mcp config <client> Print a ready-to-paste config: claude-desktop | claude-code | codex | cursor | vscode | windsurf
  safetyculture-mcp help

Flags: --mode read-only|write|full   --toolsets default,analytics,...|all   --pii none|contact|strict   --port 8787

Environment: SC_API_TOKEN (required), SC_MODE, SC_TOOLSETS, SC_PII. Docs: https://github.com/zerubroberts/safetyculture-mcp-server`;

export async function runCli(command: string, _argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  switch (command) {
    case "help":
    case "--help":
      out(HELP);
      return 0;
    case "version":
      out(VERSION);
      return 0;
    case "tools": {
      const cfg = loadConfig(env, { requireToken: false });
      const tools = selectTools(ALL_TOOLS, cfg);
      for (const id of Object.keys(TOOLSETS)) {
        const ts = tools.filter((t) => t.toolset === id);
        if (!ts.length) continue;
        out(`\n${id}: ${TOOLSETS[id as keyof typeof TOOLSETS]}`);
        for (const t of ts) out(`  ${t.name.padEnd(38)} ${t.access.padEnd(11)} ${t.title}`);
      }
      out(`\n${tools.length} tools (+2 meta) with mode=${cfg.mode}, toolsets=${cfg.toolsets === "all" ? "all" : cfg.toolsets.join(",")}`);
      return 0;
    }
    case "doctor":
      return doctor(env);
    case "config":
      out(configSnippet(_argv[_argv.indexOf("config") + 1] ?? "claude-desktop"));
      return 0;
    default:
      out(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

async function doctor(env: NodeJS.ProcessEnv): Promise<number> {
  out(`safetyculture-mcp ${VERSION} on Node ${process.versions.node}`);
  let cfg;
  try {
    cfg = loadConfig(env);
  } catch (e) {
    out(`✗ ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  out(`✓ token present (${cfg.apiToken.startsWith("scapi_") ? "scapi_ format" : "non-standard format"}, value hidden)`);
  out(`  mode=${cfg.mode}  pii=${cfg.pii}  toolsets=${cfg.toolsets === "all" ? "all" : cfg.toolsets.join(",")}`);
  const client = new ScClient(cfg);
  try {
    const me = await client.get<{ organisation_id?: string; user_id?: string }>("/accounts/user/v1/user:WhoAmI");
    const org = me.organisation_id ? createHash("sha256").update(me.organisation_id).digest("hex").slice(0, 10) : "unknown";
    out(`✓ API reachable at ${cfg.baseUrl}; authenticated (organisation fingerprint ${org})`);
  } catch (e) {
    out(`✗ API check failed: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  const tools = selectTools(ALL_TOOLS, cfg);
  const by = (a: string) => tools.filter((t) => t.access === a).length;
  out(`✓ ${tools.length} tools will be exposed: ${by("read")} read, ${by("write")} write, ${by("destructive")} destructive`);
  out(`  audit log: ${cfg.auditLog}`);
  return 0;
}

export function configSnippet(client: string): string {
  const serverJson = { command: "npx", args: ["-y", "safetyculture-mcp"], env: { SC_API_TOKEN: "scapi_your_token_here" } };
  switch (client) {
    case "claude-code":
      return `claude mcp add safetyculture --env SC_API_TOKEN=scapi_your_token_here -- npx -y safetyculture-mcp`;
    case "codex":
      return `# ~/.codex/config.toml\n[mcp_servers.safetyculture]\ncommand = "npx"\nargs = ["-y", "safetyculture-mcp"]\nenv = { SC_API_TOKEN = "scapi_your_token_here" }`;
    case "vscode":
      return JSON.stringify(
        {
          inputs: [{ type: "promptString", id: "sc-token", description: "Mitti / SafetyCulture API token", password: true }],
          servers: { safetyculture: { type: "stdio", command: "npx", args: ["-y", "safetyculture-mcp"], env: { SC_API_TOKEN: "${input:sc-token}" } } },
        },
        null,
        2,
      );
    case "cursor":
    case "windsurf":
    case "claude-desktop":
    default:
      return JSON.stringify({ mcpServers: { safetyculture: serverJson } }, null, 2);
  }
}
