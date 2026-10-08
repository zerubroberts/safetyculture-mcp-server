import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orgFingerprint } from "../../src/cache/store.js";
import { parseCsv } from "../../src/exports/csv.js";
import { connect, MockApi, type Recorded } from "../helpers/mock-api.js";

// Synthetic organisation and rows only.
const ORG = "role_demo_org_0001";

function feed(rows: Record<string, unknown>[]) {
  return (req: Recorded) => ({ data: rows.slice(0, Number(req.query.limit ?? 20)), metadata: { next_page: null, remaining_records: 0 } });
}

function api() {
  return new MockApi()
    .on("GET /accounts/user/v1/user:WhoAmI", { user_id: "user_1", organisation_id: ORG, firstname: "Alex", lastname: "Demo" })
    .on(
      "GET /feed/inspections",
      feed([
        { id: "audit_1", name: "Demo walk", site_id: "site-1", template_id: "t1", modified_at: "2026-09-01T00:00:00Z", created_at: "2026-09-01T00:00:00Z" },
        { id: "audit_2", name: "=cmd()", site_id: "site-2", template_id: "t1", modified_at: "2026-09-02T00:00:00Z", created_at: "2026-09-02T00:00:00Z" },
      ]),
    )
    .on("GET /feed/sites", feed([{ id: "site-1", name: "Demo Depot" }]))
    .on("GET /credentials/v1/feed/credentials", () => new Response(JSON.stringify({ message: "not licensed" }), { status: 403 }));
}

describe("feeds toolset", () => {
  it("sc_sync syncs the named feeds into a per-organisation cache file and reports per feed", async () => {
    const mock = api();
    const { call, json, config } = await connect(mock);
    const res = await call("sc_sync", { feeds: ["inspections", "sites", "credentials"] });
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/Synced 2 of 3 feeds \(3 rows fetched\); unavailable: credentials/);
    const data = json(res.text);
    expect(data.feeds.map((f: { feed: string; fetched: number }) => [f.feed, f.fetched])).toEqual([
      ["inspections", 2],
      ["sites", 1],
      ["credentials", 0],
    ]);
    expect(data.total_duration_ms).toBeGreaterThanOrEqual(0);

    const status = json((await call("sc_sync_status", {})).text);
    expect(status.cache_file).toContain(`${orgFingerprint(ORG)}.sqlite`);
    expect(status.cache_file.startsWith(config.dataDir)).toBe(true);
    expect(status.size_bytes).toBeGreaterThan(0);
    const insp = status.feeds.find((f: { feed: string }) => f.feed === "inspections");
    expect(insp).toMatchObject({ rows: 2, complete: true, watermark: "2026-09-02T00:00:00.000Z" });
    expect(status.feeds.find((f: { feed: string }) => f.feed === "credentials").unavailable).toContain("not licensed");
  });

  it("sc_list_feeds lists every feed with cached rows", async () => {
    const { call, json } = await connect(api());
    await call("sc_sync", { feeds: ["sites"] });
    const data = json((await call("sc_list_feeds", {})).text);
    expect(data.feeds).toHaveLength(23);
    expect(data.feeds.find((f: { feed: string }) => f.feed === "sites")).toMatchObject({ cached_rows: 1, path: "/feed/sites" });
    expect(data.feeds.find((f: { feed: string }) => f.feed === "schedules").path).toBe("/scheduling/v1/feed/schedules");
  });

  it("sc_read_feed reads one live page with modified_after and wraps rows as untrusted", async () => {
    const mock = api();
    const { call, json } = await connect(mock);
    const res = await call("sc_read_feed", { feed: "inspections", modified_after: "2026-09-01T00:00:00Z", limit: 1 });
    expect(res.text).toContain("<untrusted-data>");
    expect(json(res.text).rows).toHaveLength(1);
    const req = mock.calls.find((c) => c.path === "/feed/inspections")!;
    expect(req.query).toMatchObject({ limit: "1", modified_after: "2026-09-01T00:00:00.000Z", archived: "both", completed: "both" });

    const bad = await call("sc_read_feed", { feed: "sites", modified_after: "2026-09-01T00:00:00Z" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/no modified-after filter/);
    const foreign = await call("sc_read_feed", { feed: "sites", page_token: "/feed/users?after=1" });
    expect(foreign.isError).toBe(true);
  });

  it("sc_export_dataset writes a filtered CSV with formula neutralisation", async () => {
    const { call, json } = await connect(api());
    const res = await call("sc_export_dataset", { feed: "inspections", site_ids: ["site-2"], file_name: "demo export" });
    expect(res.isError).toBe(false);
    const data = json(res.text);
    expect(data.rows).toBe(1);
    expect(data.path).toMatch(/demo-export\.csv$/);
    const rows = parseCsv(readFileSync(data.path, "utf8"));
    expect(rows).toHaveLength(2);
    expect(rows[1]![rows[0]!.indexOf("name")]).toBe("'=cmd()");

    const jsonl = json((await call("sc_export_dataset", { feed: "inspections", format: "jsonl", period: "2026-09-02..2026-09-02", date_field: "created_at" })).text);
    expect(jsonl.rows).toBe(1);
    expect(existsSync(jsonl.path)).toBe(true);
    expect(JSON.parse(readFileSync(jsonl.path, "utf8").trim()).id).toBe("audit_2");
  });

  it("sc_query_cache runs read-only SQL and rejects writes and ATTACH", async () => {
    const { call, json } = await connect(api());
    await call("sc_sync", { feeds: ["inspections"] });
    const ok = await call("sc_query_cache", { sql: "SELECT json_extract(data, '$.site_id') AS site, COUNT(*) AS n FROM feed_inspections GROUP BY 1 ORDER BY 1" });
    expect(ok.isError).toBe(false);
    expect(json(ok.text).rows).toEqual([
      { site: "site-1", n: 1 },
      { site: "site-2", n: 1 },
    ]);
    for (const sql of ["DELETE FROM feed_inspections", "SELECT 1; DROP TABLE feed_inspections", "ATTACH DATABASE 'x.db' AS x", "PRAGMA writable_schema = 1"]) {
      const r = await call("sc_query_cache", { sql });
      expect(r.isError, sql).toBe(true);
    }
  });

  it("all feeds tools are read-only and visible in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["sc_list_feeds", "sc_read_feed", "sc_sync", "sc_sync_status", "sc_export_dataset", "sc_query_cache"]) expect(names).toContain(n);
  });
});
