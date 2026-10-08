import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { bearerCredential, safeEqual, startHttp } from "../../src/transports/http.js";
import { testConfig } from "../helpers/mock-api.js";

// SEC-FIX-2 finding 5: HTTP transport hardening.
const BEARER = "test-bearer-0123456789";
const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "http-test", version: "0" } },
});
const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function start(env: Record<string, string> = {}) {
  server = await startHttp(testConfig({ SC_HTTP_PORT: "0", SC_HTTP_BEARER_TOKEN: BEARER, SC_TOOLSETS: "default", ...env }), {});
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
}

describe("bearer authentication", () => {
  it("requires the Bearer scheme: the bare token in Authorization is refused with 401", async () => {
    const url = await start();
    const bare = await fetch(url, { method: "POST", headers: { ...MCP_HEADERS, authorization: BEARER }, body: INIT });
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toMatch(/^Bearer/);
    const basic = await fetch(url, { method: "POST", headers: { ...MCP_HEADERS, authorization: `Basic ${BEARER}` }, body: INIT });
    expect(basic.status).toBe(401);
    const ok = await fetch(url, { method: "POST", headers: { ...MCP_HEADERS, authorization: `Bearer ${BEARER}` }, body: INIT });
    expect(ok.status).toBe(200);
  });

  it("parses only a well-formed Bearer header", () => {
    expect(bearerCredential(`Bearer ${BEARER}`)).toBe(BEARER);
    expect(bearerCredential(`bearer ${BEARER}`)).toBe(BEARER); // the scheme is case-insensitive (RFC 7235)
    expect(bearerCredential(BEARER)).toBeUndefined();
    expect(bearerCredential(`Bearer`)).toBeUndefined();
    expect(bearerCredential(`Bearer ${BEARER} extra`)).toBeUndefined();
    expect(bearerCredential(undefined)).toBeUndefined();
  });

  it("compares tokens of any length safely (sha256 both sides, then timingSafeEqual)", () => {
    expect(safeEqual(BEARER, BEARER)).toBe(true);
    expect(safeEqual(BEARER, `${BEARER}x`)).toBe(false);
    expect(safeEqual("", BEARER)).toBe(false);
    expect(safeEqual("é", "e")).toBe(false);
  });
});

describe("origin check", () => {
  it("allows IPv6 loopback http://[::1]:x like the other loopback origins, and still refuses lookalikes", async () => {
    const url = await start();
    const status = async (origin: string) =>
      (await fetch(url, { method: "POST", headers: { ...MCP_HEADERS, origin, authorization: `Bearer ${BEARER}` }, body: INIT })).status;
    for (const origin of ["http://[::1]:5173", "http://127.0.0.1:3000", "http://localhost:8080"]) expect(await status(origin), origin).toBe(200);
    for (const origin of ["https://evil.example", "http://localhost.evil.example", "http://[::2]:5173", "null"]) expect(await status(origin), origin).toBe(403);
  });
});

describe("error responses", () => {
  it("malformed JSON gets a fixed 400 message, not the parser's error text", async () => {
    const url = await start();
    const res = await fetch(url, { method: "POST", headers: { ...MCP_HEADERS, authorization: `Bearer ${BEARER}` }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Request body is not valid JSON." });
  });
});
