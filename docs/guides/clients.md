# Install in your AI client

Every client runs the same server. You need **Node.js 22.13 or newer** and a Mitti API token ([how to make a safe one](api-token.md)). Replace `scapi_your_token` below with yours.

Try it first with no token: use `--demo` instead of the token (`"args": ["-y", "safetyculture-mcp", "--demo"]`) to load the fictional demo organisation.

Status column: **tested** = we ran this exact setup on 2026-10-08; **documented** = taken from the client's official documentation on 2026-10-08, not yet run by us.

| Client | Local (stdio) | Local HTTP server | Status |
|---|---|---|---|
| [Claude Desktop](#claude-desktop) | yes | via stdio only | documented |
| [Claude Code](#claude-code) | yes | yes | tested |
| [Codex (CLI, IDE, ChatGPT desktop)](#codex) | yes | yes | tested |
| [ChatGPT (web)](#chatgpt) | via tunnel | public HTTPS + OAuth only | documented |
| [Cursor](#cursor) | yes | yes | documented |
| [VS Code / GitHub Copilot](#vs-code) | yes | yes | documented |
| [Devin Desktop (formerly Windsurf)](#devin-desktop-formerly-windsurf) | yes | yes | documented |
| [Gemini CLI](#gemini-cli) | yes | yes | documented |
| [Zed](#zed) | yes | yes | documented |
| [Docker / server](#docker-and-the-http-transport) | yes | yes | tested |

Print a ready-made snippet for any of these with `npx -y safetyculture-mcp config <client>`.

---

## Claude Desktop
1. Open **Claude > Settings > Developer > Edit Config**. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).
2. Add:
```json
{
  "mcpServers": {
    "safetyculture": {
      "command": "npx",
      "args": ["-y", "safetyculture-mcp"],
      "env": { "SC_API_TOKEN": "scapi_your_token" }
    }
  }
}
```
3. Quit Claude completely and reopen it. The tools appear under the tools (slider) icon.

Notes: this file holds the token as plain text, so protect your user account. Claude's "custom connectors" connect from Anthropic's cloud, so they cannot reach a server on `127.0.0.1`; use the stdio setup above. Logs: `~/Library/Logs/Claude` or `%APPDATA%\Claude\logs` (`mcp-server-safetyculture.log`). On Windows, if you see `ENOENT`, make sure Node.js is installed for all users and on `PATH`.

## Claude Code
```bash
claude mcp add --transport stdio --scope user --env SC_API_TOKEN=scapi_your_token safetyculture -- npx -y safetyculture-mcp
```
- Scopes: `local` (this project, private, default), `project` (writes `.mcp.json` for your team), `user` (all projects).
- For a shared `.mcp.json`, keep the token out of the file: `"env": { "SC_API_TOKEN": "${SC_API_TOKEN}" }`.
- Check it: `claude mcp list`, then `/mcp` inside a session. Prompts appear as `/mcp__safetyculture__weekly_safety_review`.
- HTTP server instead: `claude mcp add --transport http safetyculture http://127.0.0.1:8787/mcp --header "Authorization: Bearer $SC_HTTP_BEARER_TOKEN"`.

## Codex
Works for the Codex CLI, the Codex IDE extension and the ChatGPT desktop app (they share `~/.codex/config.toml`).
```bash
codex mcp add safetyculture --env SC_API_TOKEN=scapi_your_token -- npx -y safetyculture-mcp
```
Or edit `~/.codex/config.toml` and forward the token from your environment instead of storing it:
```toml
[mcp_servers.safetyculture]
command = "npx"
args = ["-y", "safetyculture-mcp"]
env_vars = ["SC_API_TOKEN"]
startup_timeout_sec = 30
tool_timeout_sec = 90
```
`tool_timeout_sec = 90` gives first-time analytics syncs room to finish. HTTP server instead: `codex mcp add safetyculture --url http://127.0.0.1:8787/mcp --bearer-token-env-var SC_HTTP_BEARER_TOKEN`.

## ChatGPT
ChatGPT (web) only connects to MCP servers it can reach over **public HTTPS** (or through OpenAI's Secure MCP Tunnel), and only with **OAuth or no authentication**. This server's HTTP transport uses a static bearer token, so for ChatGPT today:
- Use the **Codex** or **ChatGPT desktop** setup above (local stdio), or
- Run the server behind your own HTTPS gateway that provides OAuth, then add it in **ChatGPT > Plugins > + > Add custom MCP server**. Treat this as advanced: everyone who can use that plugin gets the token's access.
Which ChatGPT plans allow custom MCP servers is not confirmed in OpenAI's documentation at the time of writing.

## Cursor
Global `~/.cursor/mcp.json` or per-project `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "safetyculture": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "safetyculture-mcp"],
      "env": { "SC_API_TOKEN": "${env:SC_API_TOKEN}" }
    }
  }
}
```
`${env:SC_API_TOKEN}` reads the token from your environment. One-click install (then set `SC_API_TOKEN` in your environment):
`cursor://anysphere.cursor-deeplink/mcp/install?name=safetyculture&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInNhZmV0eWN1bHR1cmUtbWNwIl0sImVudiI6eyJTQ19BUElfVE9LRU4iOiIke2VudjpTQ19BUElfVE9LRU59In19`

## VS Code
`.vscode/mcp.json` in your workspace (or **MCP: Open User Configuration** for all workspaces). VS Code prompts for the token once and stores it securely:
```json
{
  "inputs": [
    { "type": "promptString", "id": "sc_api_token", "description": "Mitti / SafetyCulture API token", "password": true }
  ],
  "servers": {
    "safetyculture": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "safetyculture-mcp"],
      "env": { "SC_API_TOKEN": "${input:sc_api_token}" }
    }
  }
}
```
Use it from Copilot Chat in **Agent** mode. From a terminal: `code --add-mcp "{\"name\":\"safetyculture\",\"command\":\"npx\",\"args\":[\"-y\",\"safetyculture-mcp\"],\"env\":{\"SC_API_TOKEN\":\"scapi_your_token\"}}"`.

## Devin Desktop (formerly Windsurf)
Windsurf is now Devin Desktop and its config moved to `~/.config/devin/mcp_config.json` (macOS/Linux) or `%APPDATA%\devin\mcp_config.json` (Windows):
```json
{
  "mcpServers": {
    "safetyculture": {
      "command": "npx",
      "args": ["-y", "safetyculture-mcp"],
      "env": { "SC_API_TOKEN": "${env:SC_API_TOKEN}" }
    }
  }
}
```
For the HTTP server use `"serverUrl": "http://127.0.0.1:8787/mcp"` (not `url`). Older Windsurf builds used `~/.codeium/windsurf/mcp_config.json`.

## Gemini CLI
```bash
gemini mcp add -s user -e SC_API_TOKEN=scapi_your_token safetyculture npx -y safetyculture-mcp
```
Or `~/.gemini/settings.json` with `"mcpServers": { "safetyculture": { "command": "npx", "args": ["-y", "safetyculture-mcp"], "env": { "SC_API_TOKEN": "$SC_API_TOKEN" } } }`. For HTTP use `httpUrl` (in Gemini, `url` means the older SSE transport).

## Zed
In settings (`zed: open settings file`):
```json
{
  "context_servers": {
    "safetyculture": {
      "command": "npx",
      "args": ["-y", "safetyculture-mcp"],
      "env": { "SC_API_TOKEN": "scapi_your_token" }
    }
  }
}
```

## Docker and the HTTP transport
For a team server, run one container per organisation:
```bash
docker build -t safetyculture-mcp .
docker run -d --name safetyculture-mcp -p 127.0.0.1:8787:8787 \
  -e SC_API_TOKEN=scapi_your_token \
  -e SC_HTTP_BEARER_TOKEN="$(openssl rand -hex 32)" \
  -e SC_PII=strict \
  -v safetyculture-mcp-data:/data \
  safetyculture-mcp
```
- The endpoint is `http://127.0.0.1:8787/mcp`; health check `/healthz`.
- The server refuses to listen on a non-loopback address without `SC_HTTP_BEARER_TOKEN`, rejects browser Origins not in `SC_HTTP_ALLOWED_ORIGINS`, and creates a fresh server for every request.
- Put it behind your own TLS and access controls. Everyone who can call it acts with the token's permissions.
- Without Docker: `SC_API_TOKEN=... SC_HTTP_BEARER_TOKEN=... npx -y safetyculture-mcp http`.

## Configuration reference
| Variable | Default | Meaning |
|---|---|---|
| `SC_API_TOKEN` | required | Mitti API token (`SAFETYCULTURE_API_TOKEN` also accepted) |
| `SC_MODE` | `read-only` | `read-only`, `write` (create/update) or `full` (adds delete/archive/bulk, two-step) |
| `SC_TOOLSETS` | `default` | Comma list (`default,analytics,assets`) or `all`. See [TOOLS.md](../TOOLS.md) |
| `SC_PII` | `contact` | `none`, `contact` (mask emails/phones), `strict` (also names) |
| `SC_API_BASE_URL` | `https://api.mitti.com` | API host (`https://api.safetyculture.io` also works) |
| `SC_DATA_DIR` | `~/.safetyculture-mcp` | Cache, exports, reports, audit log |
| `SC_MAX_RESULT_CHARS` | `25000` | Output cap per tool call |
| `SC_REQUESTS_PER_SECOND` | `8` | Client-side rate limit |
| `SC_SYNC_BUDGET_MS` | `40000` | How long a tool waits for a cache sync before answering with partial data |
| `SC_NOTIFY_WEBHOOKS` | none | JSON map of name to Slack/Teams incoming-webhook URL for `sc_post_to_chat` |
| `SC_HTTP_HOST` / `SC_HTTP_PORT` | `127.0.0.1` / `8787` | HTTP transport bind address |
| `SC_HTTP_BEARER_TOKEN` | none | Required for non-loopback binding |
| `SC_HTTP_ALLOWED_ORIGINS` | none | Comma list of allowed browser Origins |
| `SC_DEMO` | off | `true` serves the fictional demo organisation, no token needed |
