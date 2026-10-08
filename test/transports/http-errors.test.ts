import { describe, expect, it, vi } from "vitest";
import { startHttp } from "../../src/transports/http.js";
import { testConfig } from "../helpers/mock-api.js";

// SEC-FIX-2 finding 5: internal errors must not reach the client verbatim.
const INTERNAL = "config failed reading C:/private/dir/settings with value hunter2-internal";
vi.mock("../../src/server.js", () => ({
  buildServer: () => {
    throw new Error(INTERNAL);
  },
}));

describe("HTTP 500 responses", () => {
  it("return a generic message, never err.message", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const server = await startHttp(testConfig({ SC_HTTP_PORT: "0", SC_TOOLSETS: "default" }), {});
    try {
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("private");
      expect(JSON.parse(text)).toEqual({ error: "Internal server error." });
    } finally {
      server.close();
      stderr.mockRestore();
    }
  });
});
