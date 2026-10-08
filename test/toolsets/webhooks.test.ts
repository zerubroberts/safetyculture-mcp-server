import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures synthetic: no real organisation data.
const webhook = (id: string) => ({
  webhook_id: id,
  trigger_events: ["TRIGGER_EVENT_INSPECTION_COMPLETED"],
  url: "https://hooks.example.test/demo",
  user_id: "user-1",
  organisation_id: "org-1",
  enabled: true,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-02T00:00:00Z",
  // A secret-looking field the API must never leak through the projection:
  signing_key: "must-never-appear-in-output",
});

describe("webhooks toolset", () => {
  it("lists webhooks without ever returning the signing key", async () => {
    const api = new MockApi().on("GET /webhooks/v1/webhooks", { webhook: [webhook("wh-1")] });
    const { call, json } = await connect(api);
    const res = await call("sc_list_webhooks", {});
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/webhooks/v1/webhooks" });
    expect(res.text).not.toContain("signing_key");
    expect(res.text).not.toContain("must-never-appear-in-output");
    expect(json(res.text).webhooks).toEqual([
      {
        id: "wh-1",
        url: "https://hooks.example.test/demo",
        trigger_events: ["TRIGGER_EVENT_INSPECTION_COMPLETED"],
        enabled: true,
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-02T00:00:00Z",
      },
    ]);
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_webhooks");
    expect(names).not.toContain("sc_create_webhook");
    expect(names).not.toContain("sc_delete_webhook");
  });

  it("creates a webhook with the exact body, and refuses non-https URLs", async () => {
    const api = new MockApi().on("POST /webhooks/v1/webhooks", { webhook: webhook("wh-2") });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_create_webhook", {
      url: "https://hooks.example.test/demo",
      trigger_events: ["TRIGGER_EVENT_INSPECTION_COMPLETED"],
    });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/webhooks/v1/webhooks",
      body: { url: "https://hooks.example.test/demo", trigger_events: ["TRIGGER_EVENT_INSPECTION_COMPLETED"] },
    });
    expect(json(res.text)).toMatchObject({ id: "wh-2" });

    const bad = await call("sc_create_webhook", { url: "http://hooks.example.test/demo", trigger_events: ["TRIGGER_EVENT_ACTION_CREATED"] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/https/);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);

    const bogus = await call("sc_create_webhook", { url: "https://hooks.example.test/demo", trigger_events: ["NOT_A_REAL_EVENT"] });
    expect(bogus.isError).toBe(true);
  });

  it("delete is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET ^/webhooks/v1/webhooks/[^/]+$", { webhook: webhook("wh-1") })
      .on("DELETE /webhooks/v1/webhooks/wh-1", {});
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_delete_webhook", { webhook_id: "wh-1" });
    expect(dry.isError).toBe(false);
    expect(dry.text).toContain("DRY RUN");
    expect(dry.text).toContain("https://hooks.example.test/demo");
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;

    const wrong = await call("sc_delete_webhook", { webhook_id: "wh-2", confirm_token: token });
    expect(wrong.isError).toBe(true);

    const ok = await call("sc_delete_webhook", { webhook_id: "wh-1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);

    const replay = await call("sc_delete_webhook", { webhook_id: "wh-1", confirm_token: token });
    expect(replay.isError).toBe(true);
  });
});
