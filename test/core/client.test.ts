import { describe, expect, it } from "vitest";
import { ScClient } from "../../src/core/client.js";
import { ScApiError } from "../../src/core/errors.js";
import { MockApi } from "../helpers/mock-api.js";

const cfg = { apiToken: "scapi_secret_value_123456", baseUrl: "https://api.example.test", requestsPerSecond: 1000, timeoutMs: 5000, maxRetries: 2, integrationId: "t" };

describe("ScClient", () => {
  it("retries 429 then succeeds, honouring Retry-After", async () => {
    let n = 0;
    const api = new MockApi().on("GET /x", () => (++n < 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : { ok: true }));
    const c = new ScClient(cfg, api.fetch);
    expect(await c.get("/x")).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it("does not retry a POST on 500 (a write may have happened)", async () => {
    let n = 0;
    const api = new MockApi().on("POST /w", () => {
      n++;
      return new Response("boom", { status: 500 });
    });
    const c = new ScClient(cfg, api.fetch);
    await expect(c.post("/w", {})).rejects.toBeInstanceOf(ScApiError);
    expect(n).toBe(1);
  });

  it("never puts the token in error messages", async () => {
    const api = new MockApi().on("GET /bad", () => new Response(`echo Bearer ${cfg.apiToken}`, { status: 400 }));
    const c = new ScClient(cfg, api.fetch);
    const err = (await c.get("/bad").catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(cfg.apiToken);
  });

  it("follows feed next_page and stops on a repeating cursor", async () => {
    const api = new MockApi().on("GET /feed/things", (r: { query: Record<string, string> }) =>
      r.query.page === "2"
        ? { data: [{ id: 3 }], metadata: { next_page: "/feed/things?page=2" } }
        : { data: [{ id: 1 }, { id: 2 }], metadata: { next_page: "/feed/things?page=2" } },
    );
    const c = new ScClient(cfg, api.fetch);
    const res = await c.collectFeed<{ id: number }>("/feed/things");
    expect(res.items.map((i) => i.id)).toEqual([1, 2, 3]);
    expect(res.stuck).toBe(true);
  });

  it("refuses to send the token to another host via next_page", async () => {
    const api = new MockApi().on("GET /feed/x", { data: [], metadata: { next_page: "https://evil.example/steal" } });
    const c = new ScClient(cfg, api.fetch);
    await expect(c.collectFeed("/feed/x")).rejects.toThrow(/other than the configured/);
  });
});
