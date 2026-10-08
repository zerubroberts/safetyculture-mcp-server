import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CacheReader, FeedName } from "../../src/cache/contract.js";
import type { ToolContext } from "../../src/core/registry.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { analyzeFailedItems } from "../../src/analytics/failed-items.js";
import { computeInspectorActivity } from "../../src/analytics/inspectors.js";
import { analyzeScheduleCompliance } from "../../src/analytics/schedule-compliance.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { parsePeriod } from "../../src/core/time.js";
import { reportsTools } from "../../src/toolsets/reports.js";
import { buildActionBacklog, buildInspectionQuality, buildMonthlyBoardPack, buildScheduleCompliance } from "../../src/reports/build-more.js";
import type { Built } from "../../src/reports/build.js";
import { renderHtml } from "../../src/reports/html.js";
import { renderMarkdown } from "../../src/reports/markdown.js";
import type { Report } from "../../src/reports/model.js";
import { UNUSABLE, stateCache } from "../analytics/feed-states.js";
import { NOW } from "./fixtures.js";
import { data, fake } from "./org-fixture.js";

const OUT = mkdtempSync(join(tmpdir(), "scmcp-more-reports-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

function ctx(c: CacheReader, pii: "contact" | "strict" = "contact"): ToolContext {
  return {
    cache: { ensure: async () => c, open: async () => { throw new Error("not used"); } },
    config: { exportDir: OUT, pii } as ToolContext["config"],
    now: () => NOW,
  } as unknown as ToolContext;
}
const tool = (name: string) => reportsTools.find((t) => t.name === name)!;

function assertSafe(html: string) {
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;script&gt;");
  for (const url of html.match(/(?:https?:)?\/\/[^\s"'<>)]+/gi) ?? []) expect(url.startsWith("https://app.safetyculture.com/")).toBe(true);
  expect(html).not.toMatch(/<link|<img|<iframe|@import|url\(|src=/i);
}

const NEW: Array<{ tool: string; name: string; build: (c: CacheReader) => Built }> = [
  { tool: "sc_report_monthly_board_pack", name: "monthly board pack", build: (c) => buildMonthlyBoardPack(c, {}, NOW) },
  { tool: "sc_report_action_backlog", name: "action backlog", build: (c) => buildActionBacklog(c, {}, NOW) },
  { tool: "sc_report_schedule_compliance", name: "schedule compliance", build: (c) => buildScheduleCompliance(c, {}, NOW) },
  { tool: "sc_report_inspection_quality", name: "inspection quality", build: (c) => buildInspectionQuality(c, {}, NOW) },
];

describe("new default report tools write safe, self-contained files", () => {
  for (const r of NEW)
    it(r.tool, async () => {
      const res = await tool(r.tool).run({}, ctx(fake()));
      const d = res.data as { html_path: string; markdown_path: string; organisation_fingerprint: string };
      expect(existsSync(d.html_path)).toBe(true);
      expect(existsSync(d.markdown_path)).toBe(true);
      expect(d.html_path.startsWith(join(OUT, "reports"))).toBe(true);
      const html = readFileSync(d.html_path, "utf8");
      assertSafe(html);
      expect(html).toContain(d.organisation_fingerprint);
      expect(html).toContain("Data from Mitti via safetyculture-mcp");
      expect(html).toContain("@page{size:A4");
      expect(html).toContain("Executive summary");
      expect(html).not.toContain("role_demo-org-0001");
      expect(html).not.toMatch(/rotate\(/);
      const md = readFileSync(d.markdown_path, "utf8");
      expect(md).not.toContain("<script");
      for (const url of md.match(/https?:\/\/[^\s)]+/g) ?? []) expect(url.startsWith("https://app.safetyculture.com/")).toBe(true);
      expect(res.untrusted).toBe(true);
      expect(res.summary).toContain(d.html_path);
    });

  it("strict PII pseudonymises assignee rows in the backlog file", async () => {
    const plain = readFileSync((((await tool("sc_report_action_backlog").run({}, ctx(fake()))).data) as { html_path: string }).html_path, "utf8");
    expect(plain).toContain("Blair Sample");
    const res = await tool("sc_report_action_backlog").run({}, ctx(fake(), "strict"));
    const html = readFileSync((res.data as { html_path: string }).html_path, "utf8");
    const md = readFileSync((res.data as { markdown_path: string }).markdown_path, "utf8");
    for (const out of [html, md]) {
      expect(out).toMatch(/person\\?_[0-9a-f]{10}/); // Markdown escapes the underscore
      expect(out).not.toContain("Blair Sample");
      expect(out).not.toContain("Alex &lt;script");
    }
  });

  it("strict PII pseudonymises inspector names in the quality file", async () => {
    const res = await tool("sc_report_inspection_quality").run({}, ctx(fake(), "strict"));
    const html = readFileSync((res.data as { html_path: string }).html_path, "utf8");
    expect(html).toMatch(/person_[0-9a-f]{10}/);
    expect(html).not.toContain("Blair Sample");
    expect(html).not.toContain("Casey Example");
    expect(html).not.toContain("Alex &lt;script");
  });
});

describe("headline metrics equal the analytics outputs", () => {
  it("monthly board pack", () => {
    const b = buildMonthlyBoardPack(fake(), {}, NOW);
    const p = safetyPulse(fake(), { period: "last month" }, NOW).result.table;
    const backlog = analyzeActionBacklog(fake(), { period: "last month" }, NOW).result.metrics;
    const sched = analyzeScheduleCompliance(fake(), { period: "last month" }, NOW).result.metrics;
    expect(b.metrics.inspections_completed).toBe(p.find((r) => r.metric === "inspections_completed")!.current);
    expect(b.metrics.failed_item_rate).toBe(p.find((r) => r.metric === "failed_item_rate")!.current);
    expect(b.metrics.open_actions).toBe(backlog.open);
    expect(b.metrics.overdue_actions).toBe(backlog.overdue);
    expect(b.metrics.schedule_on_time_pct).toBe(sched.compliance_pct);
    expect(b.report.periodLabel).toBe(parsePeriod("last month", NOW).label);
    expect(b.report.title).toBe("Monthly board pack: September 2026");
  });

  it("action backlog", () => {
    const b = buildActionBacklog(fake(), {}, NOW);
    const m = analyzeActionBacklog(fake(), { period: "last 90 days" }, NOW).result.metrics;
    expect(b.metrics).toEqual({
      open_actions: m.open,
      overdue_actions: m.overdue,
      no_due_date: m.open_no_due_date,
      older_than_90_days: m.age_90_plus,
      median_resolution_days: m.median_resolution_days,
      opened_in_period: m.opened_in_period,
      closed_in_period: m.closed_in_period,
    });
    expect(b.metrics).toMatchObject({ open_actions: 4, overdue_actions: 2, no_due_date: 1, older_than_90_days: 1 });
    // assignee rows carry group_kind "person" (the sanitiser's cue)
    const bars = b.report.sections.flatMap((s) => s.blocks).filter((x) => x.kind === "bars");
    const asg = bars.find((x) => x.kind === "bars" && x.rows.some((r) => r.label === "Blair Sample"));
    expect(asg && asg.kind === "bars" && asg.rows.every((r) => r.group_kind === "person")).toBe(true);
  });

  it("schedule compliance", () => {
    const b = buildScheduleCompliance(fake(), {}, NOW);
    const m = analyzeScheduleCompliance(fake(), { period: "last 12 weeks" }, NOW).result.metrics;
    expect(b.metrics).toMatchObject({ due: m.due, on_time: m.on_time, late: m.late, missed: m.missed, compliance_pct: m.compliance_pct });
    expect(m.due).toBeGreaterThan(0);
  });

  it("inspection quality", () => {
    const b = buildInspectionQuality(fake(), {}, NOW);
    const f = analyzeFailedItems(fake(), { period: "last 90 days" }, NOW).result.metrics;
    const i = computeInspectorActivity(fake(), { period: parsePeriod("last 90 days", NOW) }, NOW).result.metrics;
    expect(b.metrics).toMatchObject({ inspections_completed: f.inspections, failed_answers: f.failed_items, failed_item_rate: f.failure_rate_pct, inspectors: i.inspectors });
    expect(b.metrics.templates_reviewed).toBe(2);
  });
});

/** Per report, the feeds whose loss must read "unavailable", and text that would be a fabricated zero. */
const BROKEN: Array<{ report: number; feed: FeedName; zeros: RegExp[]; nullMetrics: string[] }> = [
  { report: 0, feed: "actions", zeros: [/\| Open actions \| 0 \|/, /\b0 open actions/, /\b0 overdue/], nullMetrics: ["open_actions", "overdue_actions"] },
  { report: 0, feed: "inspections", zeros: [/\| Inspections completed \| 0 \|/, /\b0 inspections/], nullMetrics: ["inspections_completed"] },
  { report: 0, feed: "schedule_occurrences", zeros: [/\b0% of resolved/, /On time \| 0%/], nullMetrics: ["schedule_on_time_pct"] },
  { report: 1, feed: "actions", zeros: [/\| Open actions \| 0 \|/, /\b0 actions? (is|are) open/], nullMetrics: ["open_actions", "overdue_actions", "opened_in_period"] },
  { report: 2, feed: "schedule_occurrences", zeros: [/\| On time \| 0%/, /\b0% of /, /\b0 scheduled/], nullMetrics: ["due", "compliance_pct"] },
  { report: 3, feed: "inspections", zeros: [/\| Inspections completed \| 0 \|/, /\b0 inspections/], nullMetrics: ["inspections_completed", "failed_answers", "cut_candidates"] },
  { report: 3, feed: "inspection_items", zeros: [/\| Failed-item rate \| 0%/, /\b0 of 0 answers/], nullMetrics: ["failed_answers", "failed_item_rate", "cut_candidates"] },
];

describe("new reports fail closed", () => {
  for (const b of BROKEN)
    for (const u of UNUSABLE)
      it(`${NEW[b.report]!.name}: ${b.feed} ${u.name} renders unavailable, never 0`, () => {
        const built = NEW[b.report]!.build(stateCache(data(), b.feed, u));
        const html = renderHtml(built.report);
        const md = renderMarkdown(built.report);
        for (const out of [html, md, built.summary]) {
          expect(out).not.toMatch(/\bnull\b/);
          for (const z of b.zeros) expect(out).not.toMatch(z);
        }
        for (const out of [html, md]) {
          expect(out).toMatch(/unavailable/);
          expect(out).toMatch(u.reason);
        }
        for (const k of b.nullMetrics) expect(built.metrics[k], k).toBeNull();
      });

  it("action backlog: unreadable assignees withhold only the assignee exhibit", () => {
    const built = buildActionBacklog(stateCache(data(), "action_assignees", UNUSABLE[0]), {}, NOW);
    const md = renderMarkdown(built.report);
    expect(md).toMatch(/Assignee figures unavailable: the action\\?_assignees feed could not be read/);
    expect(built.metrics.open_actions).toBe(4);
  });

  for (const r of NEW)
    it(`${r.name}: healthy feeds render no "unavailable" and no "null"`, () => {
      const md = renderMarkdown(r.build(stateCache(data())).report);
      expect(md).not.toMatch(/unavailable/);
      expect(md).not.toMatch(/\bnull\b/);
    });

  it("schedule compliance: synced and empty occurrences say no data, not 0%", () => {
    const built = buildScheduleCompliance(fake({ ...data(), schedule_occurrences: [] }), {}, NOW);
    const md = renderMarkdown(built.report);
    expect(md).toContain("No scheduling data in the cache");
    expect(md).not.toMatch(/\| On time \| 0%/);
    expect(md).toContain("This is not 0% or 100% compliance.");
    expect(built.metrics.compliance_pct).toBeNull();
  });
});

describe("exhibit renderer", () => {
  const report = (blocks: Report["sections"][number]["blocks"]): Report => ({ title: "T", fingerprint: "f", periodLabel: "p", generatedAt: "g", summary: ["12 inspections."], sections: [{ title: "S", blocks }] });
  const long = "A very long site name that would never fit in the label column of a phone screen";
  const all = report([
    { kind: "bars", title: "Bars title", valueLabel: "Overdue", rows: [{ label: long, value: 12, note: "of 40" }, { label: "Short", value: 3 }] },
    { kind: "stacked", title: "Stacked title", segments: [{ label: "On time", tone: "mid" }, { label: "Missed", tone: "risk" }], rows: [{ label: long, values: [8, 2] }], percent: true },
    { kind: "dumbbell", title: "Dumbbell title", fromLabel: "before", toLabel: "after", unit: "%", good: "down", rows: [{ label: "A", from: 4, to: 6 }, { label: "B", from: 6, to: 2 }] },
    { kind: "heatmap", title: "Heatmap title", rowHeader: "Site", columns: ["2026-09-07", "2026-09-14"], partial: [false, true], rows: [{ label: "A", values: [50, null] }], unit: "%", good: "up", max: 100 },
    { kind: "multiples", title: "Multiples title", xLabels: ["2026-08", "2026-09"], panels: [{ label: "A", values: [1, 3], highlight: true }, { label: "B", values: [2, null] }] },
    { kind: "bullets", title: "Bullets title", compareLabel: "previous period", rows: [{ label: "On time", value: 80, compare: 90, unit: "%", max: 100, good: "up" }] },
    { kind: "unavailable", text: "Action figures unavailable: the actions feed could not be read (HTTP 403)." },
  ]);

  it("draws every exhibit at desktop and phone width with numbered action titles", () => {
    const html = renderHtml(all);
    expect(html.match(/class="viz-w"/g)).toHaveLength(6);
    expect(html.match(/class="viz-n"/g)).toHaveLength(6);
    for (let n = 1; n <= 6; n++) expect(html).toContain(`Exhibit ${n}<`);
    expect(html).toContain("Bars title");
    expect(html).toContain("<b>12</b> inspections.");
    expect(html).toContain("Not available");
    expect(html).not.toMatch(/rotate\(/);
  });

  it("ellipsises long labels and keeps the full text in a tooltip", () => {
    const html = renderHtml(all);
    expect(html).toContain("…");
    expect(html).toContain(`<title>${long}</title>`);
  });

  it("keeps every start-anchored label inside the exhibit width (estimated)", () => {
    const html = renderHtml(all);
    for (const svg of html.match(/<svg viewBox="0 0 \d+ \d+"[\s\S]*?<\/svg>/g) ?? []) {
      const W = Number(svg.match(/viewBox="0 0 (\d+)/)![1]);
      for (const m of svg.matchAll(/<text x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</g)) {
        if (/text-anchor/.test(m[0])) continue;
        const x = Number(m[1]);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(W);
      }
      for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
    }
  });

  it("Markdown twin carries each exhibit as a table", () => {
    const md = renderMarkdown(all);
    expect(md).toContain("## Executive summary");
    expect(md).toContain("*Bars title*");
    expect(md).toMatch(/\| On time \| Missed \| Total \|/);
    expect(md).toMatch(/\| A \| 4% \| 6% \|/);
    expect(md).toMatch(/\| Site \| 7 Sep 2026 \| 14 Sep 2026 † \|/);
    expect(md).toContain("> **Not available.** Action figures unavailable");
  });
});
