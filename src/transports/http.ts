import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../core/config.js";
import { redactSecrets, registerSecret } from "../security/redact.js";
import { buildServer } from "../server.js";

// Bind hosts and Origin hostnames. WHATWG URL keeps the brackets on IPv6 hostnames
// (new URL("http://[::1]:3000").hostname === "[::1]"), so both spellings are listed.
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/** Constant-time comparison that does not leak the expected length: both sides are hashed first. */
export function safeEqual(a: string, b: string) {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

/** The credential of an `Authorization: Bearer <token>` header, or undefined when the scheme is missing or different. */
export function bearerCredential(header: string | undefined): string | undefined {
  const m = /^Bearer +(\S+) *$/i.exec(header ?? "");
  return m?.[1];
}

/** Errors whose message is ours and safe to show a client; everything else gets a generic 500. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
  registerSecret(config.apiToken, { pin: true });
  registerSecret(bearerToken, { pin: true });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Fixed base: a malformed Host header must never reach the URL parser (it would throw before
    // any error handling and crash the process).
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return send(res, 400, { error: "Bad request." });
    }
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname !== "/mcp") return send(res, 404, { error: "Not found. The MCP endpoint is /mcp." });

    // DNS rebinding without an Origin header: when bound to loopback, only loopback Host names
    // (or names explicitly allowed) may reach the server.
    if (LOOPBACK.has(host) && !hostAllowed(req.headers.host, allowedOrigins)) {
      return send(res, 403, { error: "Host not allowed." });
    }

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin) && !isLoopbackOrigin(origin)) {
      return send(res, 403, { error: "Origin not allowed. Add it to SC_HTTP_ALLOWED_ORIGINS." });
    }
    if (bearerToken) {
      // The "Bearer " scheme is required: a bare token in Authorization is refused.
      const got = bearerCredential(req.headers.authorization);
      if (!got || !safeEqual(got, bearerToken)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="safetyculture-mcp"');
        return send(res, 401, { error: "Missing or wrong bearer token." });
      }
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
      // Never echo err.message to the client (it can carry config details, paths or upstream
      // text). Operators get a redacted line on stderr.
      if (err instanceof HttpError) {
        if (!res.headersSent) send(res, err.status, { error: err.message });
        return;
      }
      process.stderr.write(`[safetyculture-mcp] HTTP request failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}\n`);
      if (!res.headersSent) send(res, 500, { error: "Internal server error." });
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

function hostAllowed(hostHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!hostHeader) return true; // HTTP/1.0 clients; the bearer and Origin checks still apply
  try {
    const name = new URL(`http://${hostHeader}`).hostname;
    if (LOOPBACK.has(name)) return true;
    return allowedOrigins.some((o) => {
      try {
        return new URL(o).hostname === name;
      } catch {
        return false;
      }
    });
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
    if (size > 4 * 1024 * 1024) throw new HttpError(413, "Request body too large.");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
