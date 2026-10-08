import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../src/core/registry.js";
import { reportsTools } from "../../src/toolsets/reports.js";
import { analyticsExtraTools } from "../../src/toolsets/analytics-extra.js";
import { buildAuditPack, buildSafetyPulse, buildSiteScorecard } from "../../src/reports/build.js";
import { esc } from "../../src/reports/html.js";
import { mdEsc } from "../../src/reports/markdown.js";
import { fmt } from "../../src/reports/model.js";
import { pulseSections, scheduleSummary } from "../../src/reports/sections.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, issue, item, site } from "./fixtures.js";

const EVIL = '<script>alert("x")</script>';
const OUT = mkdtempSync(join(tmpdir(), "scmcp-reports-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

/** 25 inspections this week (each 4 answered, 1 failed), 20 last week (4 answered, 0 failed). */
function cache() {
  const ins: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  for (let k = 0; k < 25; k++) {
    const id = `audit_w${k}`;
    ins.push(insp(id, { tpl: "template_t1", tplName: `Pre-start ${EVIL}`, site: "site-1", owner: "user_a", ownerName: `Alex ${EVIL}`, completed: `2026-10-0${2 + (k % 6)}T09:00:00.000Z`, score: 90, duration: 600 }));
    its.push(item(id, `Guard ${EVIL}`, { response: "No", failed: true }), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
  }
  for (let k = 0; k < 20; k++) {
    const id = `audit_p${k}`;
    ins.push(insp(id, { tpl: "template_t1", site: "site-1", completed: `2026-09-2${5 + (k % 5)}T09:00:00.000Z`, score: 100, duration: 600 }));
    its.push(item(id, "Q1"), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
  }
  return new FakeCache()
    .seed("inspections", ins)
    .seed("inspection_items", its)
    .seed("sites", [site("site-1", `Depot ${EVIL}`)])
    .seed("templates", [{ id: "template_t1", name: `Pre-start ${EVIL}`, organisation_id: "role_demo-org-0001" }])
    .seed("users", [])
    .seed("actions", [
      action("a-1", { title: `Fix guard ${EVIL}`, priority: "HIGH", created: "2026-09-01T00:00:00Z", due: "2026-09-20T00:00:00Z" }),
      action("a-2", { title: "Replace sign", priority: "LOW", created: "2026-10-01T00:00:00Z", due: "2026-12-01T00:00:00Z" }),
      action("a-3", { title: "Done one", status: "COMPLETE", created: "2026-09-01T00:00:00Z", completed: "2026-09-04T00:00:00Z" }),
    ])
    .seed("issues", [issue("i-1", { category: `Slip ${EVIL}`, created: "2026-10-03T00:00:00Z", priority: "High", title: `Wet floor ${EVIL}` })])
    .seed("schedule_occurrences", [
      { id: "o1", template_id: "template_t1", due_time: "2026-10-03T17:00:00Z", occurrence_status: "COMPLETED" },
      { id: "o2", template_id: "template_t1", due_time: "2026-10-04T17:00:00Z", occurrence_status: "LATE" },
      { id: "o3", template_id: "template_t1", due_time: "2026-10-05T17:00:00Z", occurrence_status: "MISSED" },
      { id: "o4", template_id: "template_t1", due_time: "2026-10-06T17:00:00Z", occurrence_status: "COMPLETED" },
      { id: "o5", template_id: "template_t1", due_time: "2026-10-12T17:00:00Z", occurrence_status: "TODO" },
    ]);
}

function ctx(c: FakeCache, pii: "contact" | "strict" = "contact"): ToolContext {
  return {
    cache: { ensure: async () => c, open: async () => { throw new Error("not used"); } },
    config: { exportDir: OUT, pii } as ToolContext["config"],
    now: () => NOW,
  } as unknown as ToolContext;
}

const tool = (name: string) => [...reportsTools, ...analyticsExtraTools].find((t) => t.name === name)!;

function assertSafe(html: string) {
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;");
  for (const url of html.match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) ?? []) expect(url.startsWith("https://app.safetyculture.com/")).toBe(true);
  expect(html).not.toMatch(/<link|<img|<iframe|@import|url\(|src=/i);
}

describe("escaping and formatting", () => {
  it("escapes HTML and Markdown", () => {
    expect(esc(`a<b>"c"&'d'`)).toBe("a&lt;b&gt;&quot;c&quot;&amp;&#39;d&#39;");
    expect(mdEsc("a|b <i>x</i> *y*")).toBe("a\\|b &lt;i&gt;x&lt;/i&gt; \\*y\\*");
    expect(fmt(1234567.5, "%")).toBe("1,234,567.5%");
    expect(fmt(null)).toBe("n/a");
  });
});

describe("report sections (core analytics underneath)", () => {
  it("KPI deltas only with >= 20 observations in both periods", () => {
    const k = pulseSections(cache(), "last 7 days", undefined, NOW);
    const t = (l: string) => k.tiles.find((x) => x.label === l)!;
    expect(t("Inspections completed")).toMatchObject({ value: 25, previous: 20, delta: 5 });
    expect(t("Failed-item rate")).toMatchObject({ value: 25, previous: 0, delta: 25 });
    expect(t("Average score")).toMatchObject({ value: 90, previous: 100, delta: -10 });
    expect(t("Issues reported")).toMatchObject({ value: 1, delta: null });
    expect(t("Issues reported").note).toContain("too few to compare");
    expect(t("Open overdue actions")).toMatchObject({ value: 1 });
    expect(t("Open overdue actions").note).toContain("most overdue 18 days");
    // tiles carry exactly the core pulse numbers
    expect(k.tiles.map((x) => x.value)).toEqual(k.pulse.result.table.map((r) => r.current));
  });

  it("schedule compliance from the core analytic", () => {
    const s = scheduleSummary(cache(), "last 7 days", undefined, NOW);
    expect(s.metrics).toMatchObject({ due: 4, on_time: 2, late: 1, missed: 1, compliance_pct: 50, late_pct: 25, missed_pct: 25 });
    expect(scheduleSummary(new FakeCache().seed("schedule_occurrences", []), "last 7 days", undefined, NOW).metrics.due).toBeNull();
  });

  it("pulse attention list is the core top three, by severity", () => {
    const b = buildSafetyPulse(cache(), { period: "last 7 days" }, NOW);
    const list = b.report.sections[0]!.blocks[0] as { kind: "list"; items: Array<{ text: string; href?: string }> };
    expect(list.items).toHaveLength(3);
    expect(list.items[0]!.text).toBe(`High-priority action "Fix guard ${EVIL}" is 18 days overdue.`);
    expect(list.items[0]!.href).toBe("https://app.safetyculture.com/actions/a-1");
    expect(list.items[1]!.text).toContain("missed on template");
    expect(list.items[2]!.text).toContain("rose 25 points");
    expect(b.metrics).toMatchObject({ inspections_completed: 25, failed_item_rate: 25, overdue_actions: 1, attention_items: 3 });
  });

  it("audit pack figures", () => {
    const all = buildAuditPack(cache(), { period: "last 12 months" }, NOW);
    expect(all.metrics).toMatchObject({ inspections_completed: 45, failed_answers: 25, open_actions: 2, overdue_actions: 1, issues: 1, schedule_on_time_pct: 50 });
    // occurrences carry no site here, so a site-scoped pack cannot attribute them
    const scoped = buildAuditPack(cache(), { period: "last 12 months", site_ids: ["site-1"] }, NOW);
    expect(scoped.metrics.schedule_on_time_pct).toBeNull();
    expect(JSON.stringify(scoped.report)).toContain("could not be tied to a single site");
    const empty = buildAuditPack(cache().seed("schedule_occurrences", []), { period: "last 12 months" }, NOW);
    expect(JSON.stringify(empty.report)).toContain("No scheduling data in the cache");
  });

  it("site scorecard pseudonymises inspector names when asked", () => {
    const b = buildSiteScorecard(cache(), { site_id: "site-1", period: "last 6 months" }, NOW, { person: () => "person_x" });
    const s = JSON.stringify(b.report);
    expect(s).toContain("person_x");
    expect(s).not.toContain("Alex ");
    expect(b.report.title).toBe(`Site scorecard: Depot ${EVIL}`);
  });
});

describe("report tools write safe, self-contained files", () => {
  for (const [name, args] of [
    ["sc_report_safety_pulse", {}],
    ["sc_report_audit_pack", {}],
    ["sc_report_site_scorecard", { site_id: "site-1" }],
  ] as const) {
    it(name, async () => {
      const res = await tool(name).run(args, ctx(cache()));
      const data = res.data as { html_path: string; markdown_path: string; organisation_fingerprint: string };
      expect(existsSync(data.html_path)).toBe(true);
      expect(existsSync(data.markdown_path)).toBe(true);
      expect(data.html_path.startsWith(join(OUT, "reports"))).toBe(true);
      expect(data.organisation_fingerprint).toMatch(/^[0-9a-f]{10}$/);
      const html = readFileSync(data.html_path, "utf8");
      assertSafe(html);
      expect(html).toContain("Data from Mitti via safetyculture-mcp");
      expect(html).toContain(data.organisation_fingerprint);
      expect(html).toContain("<svg");
      expect(html).toContain("@page{size:A4");
      expect(html).not.toContain("role_demo-org-0001");
      const md = readFileSync(data.markdown_path, "utf8");
      expect(md).toContain("&lt;script&gt;");
      expect(md).not.toContain("<script");
      for (const url of md.match(/https?:\/\/[^\s)]+/g) ?? []) expect(url.startsWith("https://app.safetyculture.com/")).toBe(true);
      expect(res.summary).toContain(data.html_path);
      expect(res.untrusted).toBe(true);
    });
  }

  it("strict PII pseudonymises names in the scorecard file", async () => {
    const res = await tool("sc_report_site_scorecard").run({ site_id: "site-1" }, ctx(cache(), "strict"));
    const html = readFileSync((res.data as { html_path: string }).html_path, "utf8");
    expect(html).toMatch(/person_[0-9a-f]{10}/);
    expect(html).not.toContain("Alex &lt;script");
  });
});

describe("analytics-extra tool wrappers", () => {
  it("every tool runs against the cache and returns an AnalyticResult", async () => {
    const c = cache();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["sc_analyze_inspection_trend", { metric: "inspections_completed", grain: "week", period: "last 4 weeks" }],
      ["sc_analyze_template_quality", { template_id: "template_t1" }],
      ["sc_analyze_inspector_activity", {}],
      ["sc_analyze_inspection_anomalies", {}],
      ["sc_analyze_action_stalls", {}],
      ["sc_analyze_issue_hotspots", {}],
    ];
    for (const [name, args] of calls) {
      const res = await tool(name).run(args, ctx(c));
      const data = res.data as { metric_version: string; as_of: string; coverage: unknown[] };
      expect(data.as_of).toBe(NOW.toISOString());
      expect(data.metric_version).toMatch(/\/1$/);
      expect(data.coverage.length).toBeGreaterThan(0);
      expect(res.summary.length).toBeGreaterThan(10);
    }
    const trend = await tool("sc_analyze_inspection_trend").run({ metric: "inspections_completed", grain: "week", period: "2026-09-21..2026-10-04" }, ctx(c));
    expect((trend.data as { table: Array<{ value: number }> }).table.map((r) => r.value)).toEqual([12, 21]); // 09-25..27: 12; 09-28..29: 8 + 10-02..04: 13
  });
});
