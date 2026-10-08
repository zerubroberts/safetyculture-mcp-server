import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./core/config.js";
import { runCli } from "./cli.js";
import { buildServer } from "./server.js";
import { startHttp } from "./transports/http.js";

async function main() {
  const argv = process.argv.slice(2);
  const env = { ...process.env };

  // Flags map onto env vars so there is exactly one configuration surface.
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "--mode") env.SC_MODE = next();
    else if (a === "--read-only") env.SC_MODE = "read-only";
    else if (a === "--toolsets") env.SC_TOOLSETS = next();
    else if (a === "--pii") env.SC_PII = next();
    else if (a === "--port") env.SC_HTTP_PORT = next();
    else if (a === "--host") env.SC_HTTP_HOST = next();
  }

  const command = argv.find((a) => !a.startsWith("-") && !/^\d+$/.test(a));
  if (command && command !== "serve" && command !== "http") {
    process.exitCode = await runCli(command, argv, env);
    return;
  }

  const config = loadConfig(env);
  if (command === "http" || argv.includes("--http")) {
    await startHttp(config, env);
    return;
  }
  const { server, tools } = buildServer(config);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[safetyculture-mcp] ready on stdio: ${tools.length} tools, mode ${config.mode}\n`);
}

main().catch((err) => {
  const msg = err instanceof ConfigError ? `Configuration error: ${err.message}` : err instanceof Error ? err.message : String(err);
  process.stderr.write(`[safetyculture-mcp] ${msg}\n`);
  process.exit(1);
});
