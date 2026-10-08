import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../core/config.js";
import { buildServer } from "../server.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Streamable HTTP transport, stateless: every request gets a fresh MCP server instance, so no
 * state or data can leak between callers. Security defaults:
 * - binds to 127.0.0.1 unless SC_HTTP_HOST says otherwise
 * - refuses to bind to a non-loopback address without SC_HTTP_BEARER_TOKEN
 * - checks the Origin header (DNS-rebinding protection) against SC_HTTP_ALLOWED_ORIGINS
 * - optional per-request Mitti token via X-SC-API-Token when SC_HTTP_ALLOW_CLIENT_TOKENS=true
 */
export async function startHttp(config: Config, env: NodeJS.ProcessEnv = process.env) {
  const { host, port, bearerToken, allowedOrigins } = config.http;
  if (!LOOPBACK.has(host) && !bearerToken) {
    throw new Error("Refusing to listen on a non-loopback address without SC_HTTP_BEARER_TOKEN. Set one, or bind to 127.0.0.1.");
  }
  const allowClientTokens = /^(1|true|yes)$/i.test(env.SC_HTTP_ALLOW_CLIENT_TOKENS ?? "");

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname !== "/mcp") return send(res, 404, { error: "Not found. The MCP endpoint is /mcp." });

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin) && !isLoopbackOrigin(origin)) {
      return send(res, 403, { error: "Origin not allowed. Add it to SC_HTTP_ALLOWED_ORIGINS." });
    }
    if (bearerToken) {
      const got = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!got || !safeEqual(got, bearerToken)) return send(res, 401, { error: "Missing or wrong bearer token." });
    }

    let cfg = config;
    const clientToken = req.headers["x-sc-api-token"];
    if (typeof clientToken === "string" && clientToken) {
      if (!allowClientTokens) return send(res, 400, { error: "Per-request tokens are disabled on this server." });
      cfg = { ...config, apiToken: clientToken };
    }

    try {
      const { server } = buildServer(cfg);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, await readJson(req));
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  process.stderr.write(`[safetyculture-mcp] HTTP transport listening on http://${host}:${port}/mcp (mode: ${config.mode})\n`);
  return httpServer;
}

function isLoopbackOrigin(origin: string) {
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4 * 1024 * 1024) throw new Error("Request body too large.");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
