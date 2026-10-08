// Builds the marketing showcase from the fictional demo organisation ONLY (never a real org):
// real tool outputs (site/data/*.json) and generated reports (site/reports/*.html).
//   npx tsx scripts/build-showcase.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/core/config.js";
import { buildServer } from "../src/server.js";

const out = "site";
mkdirSync(join(out, "data"), { recursive: true });
mkdirSync(join(out, "reports"), { recursive: true });

const config = loadConfig({ SC_DEMO: "true", SC_MODE: "full", SC_TOOLSETS: "all", SC_DATA_DIR: mkdtempSync(join(tmpdir(), "scmcp-showcase-")) });
if (!config.demo) throw new Error("Showcase must run in demo mode.");
const { server } = buildServer(config);
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "showcase", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
  const text = res.content.map((c) => c.text).join("\n");
  if (res.isError) throw new Error(`${name} failed: ${text.slice(0, 300)}`);
  const body = text.split("\n\nNote: output trimmed")[0]!;
  const inner = body.includes("<untrusted-data>") ? body.split("<untrusted-data>\n")[1]!.split("\n</untrusted-data>")[0]! : body;
  const lines = inner.split("\n");
  const data = JSON.parse(lines.pop()!);
  const summary = lines.filter(Boolean).join(" ");
  const notice = text.startsWith("DRY RUN") ? text.split("\n\n")[0] : undefined;
  return { summary, data, notice };
}

const shots: Record<string, unknown> = {};
const save = (key: string, tool: string, args: Record<string, unknown>, r: { summary: string; data: unknown; notice?: string }) => {
  shots[key] = { tool, args, ...r };
};

await call("sc_sync", { feeds: ["inspections", "inspection_items", "actions", "action_assignees", "action_timeline_items", "issues", "sites", "users", "templates", "schedules", "schedule_occurrences", "schedule_assignees", "credentials", "credential_types"] });

const jobs: Array<[string, string, Record<string, unknown>]> = [
  ["pulse", "sc_safety_pulse", { period: "last 7 days" }],
  ["failed", "sc_analyze_failed_items", { period: "last 90 days", top: 8 }],
  ["backlog", "sc_analyze_action_backlog", { group_by: "site" }],
  ["schedules", "sc_analyze_schedule_compliance", { period: "last 30 days" }],
  ["credentials", "sc_analyze_credential_radar", { horizon: "next 30 days" }],
  ["league", "sc_analyze_site_league", { period: "last 90 days" }],
  ["anomalies", "sc_analyze_inspection_anomalies", { kind: "too_fast", period: "last 90 days" }],
  ["whoami", "sc_whoami", {}],
];
for (const [key, tool, args] of jobs) {
  try {
    save(key, tool, args, await call(tool, args));
  } catch (e) {
    console.error(String(e));
  }
}

// Compare two sites (the two clearly different ones in the demo league).
try {
  const league = shots.league as { data: { table: Array<{ site_id?: string; site?: string; id?: string }> } };
  const rows = league.data.table;
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const idOf = (r: Record<string, unknown> | undefined) => (r ? String(r.site_id ?? r.id ?? "") : "");
  if (best && worst) {
    const args = { mode: "sites", site_ids_a: [idOf(best as never)], site_ids_b: [idOf(worst as never)], period_a: "last 90 days" };
    save("compare", "sc_analyze_compare", args, await call("sc_analyze_compare", args));
  }
} catch (e) {
  console.error(`compare: ${String(e)}`);
}

// A real dry-run plan (nothing is deleted: only the plan call is made).
try {
  const list = await call("sc_list_actions", { overdue_only: true, limit: 3 });
  const ids = (list.data as { actions: Array<{ id: string }> }).actions.map((x) => x.id);
  save("dryrun", "sc_bulk_update_actions", { action_ids: ids, set: { priority: "high" } }, await call("sc_bulk_update_actions", { action_ids: ids, set: { priority: "high" }, reason: "escalate overdue items before the audit" }));
} catch (e) {
  console.error(`dryrun: ${String(e)}`);
}

writeFileSync(join(out, "data", "showcase.json"), JSON.stringify({ generated_at: new Date().toISOString(), organisation: "Northwind Facilities (fictional demo)", shots }, null, 1));

for (const [tool, slug, args] of [
  ["sc_report_safety_pulse", "safety-pulse", { period: "last 7 days" }],
  ["sc_report_audit_pack", "audit-pack", { period: "last 12 months" }],
] as const) {
  try {
    const r = await call(tool, args);
    const path = (r.data as { html_path: string }).html_path;
    copyFileSync(path, join(out, "reports", `${slug}.html`));
    copyFileSync(path.replace(/\.html$/, ".md"), join(out, "reports", `${slug}.md`));
  } catch (e) {
    console.error(`${tool}: ${String(e)}`);
  }
}

console.log(`showcase: ${Object.keys(shots).length} tool outputs, reports in ${out}/reports`);
await client.close();
