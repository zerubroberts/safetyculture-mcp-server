import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { buildServer } from "../../src/server.js";

// Starts the real server in demo mode (no fetch passed: buildServer must pick the demo API itself),
// then calls every no-argument read tool and every list -> get pair. Nothing may error.
const PAIRS: Array<[list: string, gets: string[]]> = [
  ["sc_search_inspections", ["sc_get_inspection", "sc_get_inspection_answers", "sc_get_inspection_report_link", "sc_list_inspection_media", "sc_export_inspection_document"]],
  ["sc_list_templates", ["sc_get_template"]],
  ["sc_list_response_sets", ["sc_get_response_set"]],
  ["sc_list_actions", ["sc_get_action"]],
  ["sc_list_issues", ["sc_get_issue", "sc_get_issue_timeline", "sc_get_issue_report"]],
  ["sc_list_investigations", ["sc_get_investigation"]],
  ["sc_list_assets", ["sc_get_asset", "sc_get_asset_maintenance"]],
  ["sc_list_sites", ["sc_get_site", "sc_list_site_members", "sc_site_tree"]],
  ["sc_search_users", ["sc_get_user", "sc_get_course_progress"]],
  ["sc_list_groups", ["sc_list_group_members", "sc_search_users"]],
  ["sc_list_schedules", ["sc_get_schedule"]],
  ["sc_list_courses", ["sc_get_course", "sc_get_course_progress"]],
  ["sc_list_heads_ups", ["sc_get_heads_up"]],
  ["sc_list_companies", ["sc_get_company", "sc_list_company_documents"]],
];
/** Argument name for a get tool when it is not the tool's first required field. */
const ARG: Record<string, string> = { sc_get_course_progress: "", sc_search_users: "group_id", sc_site_tree: "site_id" };

function firstId(data: unknown): string | undefined {
  const stack = [data];
  while (stack.length) {
    const v = stack.shift();
    if (Array.isArray(v)) {
      const hit = v.find((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
      if (hit) return (hit as { id: string }).id;
      stack.push(...v);
    } else if (v && typeof v === "object") stack.push(...Object.values(v));
  }
  return undefined;
}

describe("demo organisation: every read tool is served", () => {
  let client: Client;
  let required: Map<string, string[]>;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
    const text = res.content.map((c) => c.text).join("\n");
    let data: unknown;
    try {
      const body = text.split("\n\nNote: output trimmed")[0]!;
      const inner = body.includes("<untrusted-data>") ? body.split("<untrusted-data>\n")[1]!.split("\n</untrusted-data>")[0]! : body;
      data = JSON.parse(inner.split("\n").pop()!);
    } catch {
      data = undefined;
    }
    return { isError: Boolean(res.isError), text, data };
  };

  beforeAll(async () => {
    const config = loadConfig({ SC_DEMO: "true", SC_MODE: "full", SC_TOOLSETS: "all", SC_DATA_DIR: mkdtempSync(join(tmpdir(), "scmcp-demo-")) });
    expect(config.demo).toBe(true);
    expect(config.baseUrl).toBe("https://demo.safetyculture-mcp.invalid");
    const { server } = buildServer(config);
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "demo-test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools;
    required = new Map(tools.map((t) => [t.name, (t.inputSchema.required ?? []) as string[]]));
  });
  afterAll(() => client.close());

  it("lists every tool in full mode", () => {
    expect(required.size).toBeGreaterThan(120);
  });

  it("answers every no-argument read tool without an error", async () => {
    // Read tools plus local-write tools (sync, exports, reports report readOnlyHint=false).
    const localWrite = /^sc_(sync|export_|report_)/;
    const tools = (await client.listTools()).tools.filter(
      (t) => (t.annotations?.readOnlyHint || localWrite.test(t.name)) && !(t.inputSchema.required ?? []).length,
    );
    // Input guards: sc_get_course_progress needs a course or user, sc_find_asset a code or field (both covered below).
    const skip = new Set(["sc_enable_toolsets", "sc_get_course_progress", "sc_find_asset"]);
    const broken: string[] = [];
    for (const t of tools) {
      if (skip.has(t.name)) continue;
      const r = await call(t.name, t.name === "sc_query_cache" ? { sql: "SELECT COUNT(*) AS n FROM feed_inspections" } : {});
      if (r.isError) broken.push(`${t.name}: ${r.text.slice(0, 200)}`);
    }
    expect(broken).toEqual([]);
    expect(tools.length).toBeGreaterThan(50);
  }, 120_000);

  it("serves every list -> get pair with a real demo ID", async () => {
    const broken: string[] = [];
    for (const [list, gets] of PAIRS) {
      const l = await call(list, { limit: 5 });
      const id = firstId(l.data);
      if (l.isError || !id) {
        broken.push(`${list}: ${l.isError ? l.text.slice(0, 200) : "no records"}`);
        continue;
      }
      for (const g of gets) {
        const arg = ARG[g] ?? required.get(g)?.[0];
        const argName = arg || (list === "sc_list_courses" ? "course_id" : "user_id");
        const r = await call(g, { [argName]: id });
        if (r.isError) broken.push(`${g}: ${r.text.slice(0, 200)}`);
      }
    }
    expect(broken).toEqual([]);
  }, 120_000);

  it("serves the ID-taking tools that have no list partner", async () => {
    const sensors = (await call("sc_list_sensors")).data as { sensors: Array<{ source_name: string; source_id: string }> };
    const docs = (await call("sc_search_documents", { query: "plan" })).data as { files: unknown[]; folders: Array<{ id: string }> };
    const folder = ((await call("sc_search_documents", { query: "Policies" })).data as { folders: Array<{ id: string }> }).folders[0]!.id;
    const insp = firstId((await call("sc_search_inspections", { period: "last 90 days", limit: 50 })).data)!;
    const media = ((await call("sc_list_inspection_media", { inspection_id: insp })).data as { media: Array<{ id: string }> }).media;
    const boards = (await call("sc_training_leaderboard")).data as { leaderboards: Array<{ id: string }> };
    const checks: Array<[string, Record<string, unknown>]> = [
      ["sc_get_sensor_readings", sensors.sensors[0]!],
      ["sc_list_folder_items", { folder_id: folder }],
      ["sc_find_asset", { code: "FL-001" }],
      ["sc_find_asset", { field_name: "Make", field_value: "Generic Co" }],
      ["sc_training_leaderboard", { leaderboard_id: boards.leaderboards[0]!.id }],
      ["sc_list_actions", { overdue_only: true, priority: ["high"] }],
      ["sc_list_issues", { status: ["open"], period: "last 90 days" }],
      ["sc_list_schedule_occurrences", { status: ["missed"], period: "last 90 days" }],
      ["sc_list_credentials", { expiring_within: "next 30 days" }],
      ["sc_read_feed", { feed: "inspection_items", limit: 5 }],
      ...(media.length ? [["sc_get_media_url", { media_id: media[0]!.id, token: "demo-token" }] as [string, Record<string, unknown>]] : []),
    ];
    expect(docs.files.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const [name, args] of checks) {
      const r = await call(name, args);
      if (r.isError) broken.push(`${name}: ${r.text.slice(0, 200)}`);
    }
    expect(broken).toEqual([]);
  }, 60_000);

  it("lets a demo user create and complete an action in memory", async () => {
    const before = (await call("sc_list_actions", { limit: 1 })).data as { total: number };
    const site = firstId((await call("sc_list_sites", { text: "Eastgate" })).data)!;
    const created = await call("sc_create_action", { title: "Replace damaged extinguisher sign", priority: "high", site_id: site, reason: "demo test" });
    expect(created.isError, created.text).toBe(false);
    const id = (created.data as { id: string }).id;
    const after = (await call("sc_list_actions", { limit: 1 })).data as { total: number };
    expect(after.total).toBe(before.total + 1);
    expect((await call("sc_update_action", { action_id: id, status: "complete" })).isError).toBe(false);
    const got = (await call("sc_get_action", { action_id: id })).data as { status: string; site: { name: string } };
    expect(got).toMatchObject({ status: "complete", site: { name: "Eastgate Yard" } });
  });

  it("returns a clear 404 for routes the demo does not serve", async () => {
    const r = await call("sc_api_get", { path: "/feed/not_a_real_feed" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/404/);
  });
});
