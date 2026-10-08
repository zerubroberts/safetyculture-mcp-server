import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatPayload, loadWebhooks, toSlackMrkdwn } from "../../src/toolsets/integrations.js";
import { parseCsv } from "../../src/exports/csv.js";
import { connect, MockApi } from "../helpers/mock-api.js";

const HOOKS = JSON.stringify({
  safety: "https://hooks.slack.com/services/T000/B000/demo",
  ops: "https://demo.webhook.office.com/webhookb2/demo",
  flow: { url: "https://example.test/hook", type: "teams" },
  insecure: "http://hooks.slack.com/services/x",
  unknown: "https://example.test/other",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("chat webhooks", () => {
  it("loads only https webhooks with a known or declared type", () => {
    const hooks = loadWebhooks({ SC_NOTIFY_WEBHOOKS: HOOKS });
    expect([...hooks.keys()]).toEqual(["safety", "ops", "flow"]);
    expect(hooks.get("safety")!.kind).toBe("slack");
    expect(hooks.get("ops")!.kind).toBe("teams");
    expect(hooks.get("flow")!.kind).toBe("teams");
  });

  it("builds Slack text and a Teams Adaptive Card", () => {
    expect(toSlackMrkdwn("**Overdue**: see [action](https://app.example.test/a/1)")).toBe("*Overdue*: see <https://app.example.test/a/1|action>");
    expect(chatPayload("slack", "hi")).toEqual({ text: "hi" });
    const teams = chatPayload("teams", "hi") as { type: string; attachments: Array<{ contentType: string; content: { body: Array<{ text: string }> } }> };
    expect(teams.type).toBe("message");
    expect(teams.attachments[0]!.contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(teams.attachments[0]!.content.body[0]!.text).toBe("hi");
  });

  it("sc_post_to_chat posts to the named webhook only, in write mode", async () => {
    vi.stubEnv("SC_NOTIFY_WEBHOOKS", HOOKS);
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response("ok", { status: 200 });
    });
    const { call, client } = await connect(new MockApi(), { SC_MODE: "write" });
    const res = await call("sc_post_to_chat", { webhook: "safety", message: "**3** overdue actions", reason: "weekly digest" });
    expect(res.isError).toBe(false);
    expect(sent).toEqual([{ url: "https://hooks.slack.com/services/T000/B000/demo", body: { text: "*3* overdue actions" } }]);

    const raw = await call("sc_post_to_chat", { webhook: "https://attacker.example.test/hook", message: "x" });
    expect(raw.isError).toBe(true);
    expect(raw.text).toContain("Configured: safety, ops, flow");
    expect(sent).toHaveLength(1);

    const tooLong = await call("sc_post_to_chat", { webhook: "safety", message: "x".repeat(3001) });
    expect(tooLong.isError).toBe(true);

    const { client: ro } = await connect(new MockApi(), { SC_MODE: "read-only" });
    expect((await ro.listTools()).tools.map((t) => t.name)).not.toContain("sc_post_to_chat");
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("sc_post_to_chat");
  });

  it("reports webhook failures and missing configuration plainly", async () => {
    vi.stubEnv("SC_NOTIFY_WEBHOOKS", "");
    const { call } = await connect(new MockApi(), { SC_MODE: "write" });
    expect((await call("sc_post_to_chat", { webhook: "safety", message: "x" })).text).toMatch(/No chat webhooks are configured/);
    vi.stubEnv("SC_NOTIFY_WEBHOOKS", HOOKS);
    vi.stubGlobal("fetch", async () => new Response("invalid_token", { status: 403 }));
    const res = await call("sc_post_to_chat", { webhook: "ops", message: "x" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/HTTP 403/);
  });
});

describe("sc_export_bi_bundle", () => {
  it("syncs what it needs and writes a bundle whose manifest matches the CSVs", async () => {
    const empty = { data: [], metadata: { next_page: null } };
    const mock = new MockApi()
      .on("GET /accounts/user/v1/user:WhoAmI", { organisation_id: "role_demo_org_0002" })
      .on("GET /feed/inspections", { data: [{ id: "audit_1", site_id: "site-1", template_id: "t1", owner_id: "user_1", conducted_on: "2026-09-01T00:00:00Z" }], metadata: { next_page: null } })
      .on("GET /feed/inspection_items", { data: [{ id: "audit_1_i1", audit_id: "audit_1", is_failed_response: true }], metadata: { next_page: null } })
      .on("GET /feed/actions", empty)
      .on("GET /feed/issues", empty)
      .on("GET /scheduling/v1/feed/schedules", empty)
      .on("GET /scheduling/v1/feed/schedule_occurrences", empty)
      .on("GET /feed/sites", { data: [{ id: "site-1", name: "Demo Depot" }], metadata: { next_page: null } })
      .on("GET /feed/templates", empty)
      .on("GET /feed/users", { data: [{ id: "user_1", firstname: "Alex", lastname: "Demo", email: "alex@example.com" }], metadata: { next_page: null } });
    const { call, json } = await connect(mock);
    const res = await call("sc_export_bi_bundle", { folder_name: "demo-bundle" });
    expect(res.isError).toBe(false);
    const data = json(res.text);
    expect(data.folder).toMatch(/demo-bundle$/);
    expect(data.rows).toMatchObject({ fact_inspections: 1, fact_inspection_items: 1, dim_sites: 1, dim_users: 1, dim_date: 1 });
    const manifest = JSON.parse(readFileSync(join(data.folder, "manifest.json"), "utf8"));
    for (const t of manifest.tables) expect(parseCsv(readFileSync(join(data.folder, t.file), "utf8")).length - 1).toBe(t.rows);
    for (const f of ["powerbi.pq", "qlik.qvs", "README.md"]) expect(existsSync(join(data.folder, f))).toBe(true);
    // Default privacy level (contact): the email in dim_users is pseudonymised.
    expect(readFileSync(join(data.folder, "dim_users.csv"), "utf8")).not.toContain("alex@example.com");
  });
});
