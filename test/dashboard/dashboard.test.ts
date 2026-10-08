import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import type { FeedName } from "../../src/cache/contract.js";
import type { ToolContext } from "../../src/core/registry.js";
import { parsePeriod, previousPeriod } from "../../src/core/time.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { analyzeFailedItems } from "../../src/analytics/failed-items.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { analyzeScheduleCompliance } from "../../src/analytics/schedule-compliance.js";
import { analyzeSiteLeague } from "../../src/analytics/league.js";
import { computeInspectorActivity } from "../../src/analytics/inspectors.js";
import { computeTrend, siteKey } from "../../src/analytics/trend.js";
import { buildDashboardData, recentMove, type DashboardData, type TrendSeries } from "../../src/dashboard/data.js";
import { CLIENT_JS } from "../../src/dashboard/client.js";
import { DASHBOARD_CSP, embedJson, renderDashboardHtml } from "../../src/dashboard/html.js";
import { dashboardAppHtml, DASHBOARD_APP_MIME, DASHBOARD_APP_URI } from "../../src/dashboard/app.js";
import { dashboardTools } from "../../src/toolsets/dashboards.js";
import { writesLocalState } from "../../src/core/registry.js";
import { UNUSABLE, stateCache } from "../analytics/feed-states.js";
import { NOW, action, insp, issue, item, site } from "../reports/fixtures.js";

/** Synthetic organisation only: two sites, a template, actions, issues and weekly schedule occurrences. */

const EVIL = '<script>alert("x")</script>';
const OUT = mkdtempSync(join(tmpdir(), "scmcp-dashboard-"));
afterAll(() => rmSync(OUT, { recursive: true, force: true }));
const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function data(): Partial<Record<FeedName, Record<string, unknown>[]>> {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let k = 0; k < 120; k++) {
    const id = `audit_d${k}`;
    const s = k % 3 === 0 ? "site-2" : "site-1";
    inspections.push(insp(id, { tpl: "template_t1", tplName: `Pre-start ${EVIL}`, site: s, owner: k % 2 ? "user_a" : "user_b", ownerName: k % 2 ? "Alex Demo" : "Sam Sample", completed: DAYS(1 + (k % 170)), score: 80 + (k % 20), duration: 600 }));
    items.push(item(id, `Guard ${EVIL}`, { response: "No", failed: k % 4 === 0 }), item(id, "Exit clear", { failed: k % 7 === 0, response: k % 7 === 0 ? "No" : "Yes" }), item(id, "Q3"), item(id, "Q4"));
  }
  return {
    inspections,
    inspection_items: items,
    actions: [
      action("a-1", { title: `Fix guard ${EVIL}`, priority: "HIGH", created: DAYS(60), due: DAYS(20) }),
      action("a-2", { title: "Replace sign", priority: "LOW", site: "site-2", created: DAYS(10), due: DAYS(-30) }),
      action("a-3", { title: "Done one", status: "COMPLETE", created: DAYS(40), completed: DAYS(5) }),
      action("a-4", { title: "Sweep", priority: "MEDIUM", created: DAYS(3), due: DAYS(1) }),
    ],
    issues: [issue("i-1", { category: "Slip", created: DAYS(3), priority: "High", title: `Wet floor ${EVIL}` })],
    schedule_occurrences: Array.from({ length: 30 }, (_, k) => ({
      id: `o${k}`,
      schedule_id: "sch-1",
      occurrence_id: `sch-1:${k}`,
      template_id: "template_t1",
      due_time: DAYS(2 + k * 5),
      occurrence_status: k % 5 === 0 ? "MISSED" : k % 7 === 0 ? "LATE" : "COMPLETED",
    })),
    schedules: [{ id: "sch-1", title: `Weekly walk ${EVIL}`, site_ids: ["site-1"], template_id: "template_t1" }],
    schedule_assignees: [],
    sites: [site("site-1", `Depot ${EVIL}`), site("site-2", "Yard Two")],
    templates: [{ id: "template_t1", name: `Pre-start ${EVIL}`, organisation_id: "role_demo-org-0001" }],
    users: [
      { id: "user_a", firstname: "Alex", lastname: "Demo" },
      { id: "user_b", firstname: "Sam", lastname: "Sample" },
    ],
  };
}

function ctx(c: ReturnType<typeof stateCache>, pii: "contact" | "strict" = "contact"): ToolContext {
  return {
    cache: { ensure: async () => c, open: async () => { throw new Error("not used"); } },
    config: { exportDir: OUT, pii } as ToolContext["config"],
    now: () => NOW,
  } as unknown as ToolContext;
}

interface Scope {
  trends: Record<string, Record<string, TrendSeries>>;
  calendar: { unavailable: string | null };
  stripes: { weeks: Array<{ from: string; to: string; due: number; on_time: number; late: number; missed: number; compliance_pct: number | null }> };
}
const scope = (d: DashboardData, key = "all") => d.scopes[key] as Scope;
const tool = dashboardTools.find((t) => t.name === "sc_build_dashboard")!;
const embedded = (html: string): DashboardData => JSON.parse(html.split('<script type="application/json" id="dash-data">')[1]!.split("</script>")[0]!);

interface Renderer {
  view: (d: unknown, s: unknown, env: unknown) => { html: string; charts: Record<string, ((w: number) => string) | null> };
  VIEWS: string[];
}
/** The page's pure renderer, run in a sandbox with a fixed-width "font". */
const renderer = (): Renderer => runInNewContext(`${CLIENT_JS};R`, {}) as Renderer;
const ENV = { measure: (s: string, size: number) => s.length * size * 0.56 };
function renderAll(d: DashboardData, view: string, period = d.default_period, siteKey = "all", width = 1000) {
  const out = renderer().view(d, { view, period, site: siteKey, sort: {} }, ENV);
  return out.html + Object.values(out.charts).map((f) => (f ? f(width) : "")).join("");
}

async function build(c = stateCache(data()), pii: "contact" | "strict" = "contact", args: Record<string, unknown> = {}) {
  const res = await tool.run({ period: "last 90 days", ...args }, ctx(c, pii));
  const d = res.data as { html_path: string; metrics: Record<string, unknown> };
  const html = readFileSync(d.html_path, "utf8");
  return { res, path: d.html_path, metrics: d.metrics, html, data: embedded(html) };
}

describe("sc_build_dashboard", () => {
  it("is a read tool in the reports toolset that writes a local file", () => {
    expect(tool.access).toBe("read");
    expect(tool.toolset).toBe("reports");
    expect(writesLocalState(tool)).toBe(true);
  });

  it("writes <exportDir>/dashboards/safety-dashboard-<timestamp>.html and returns headline metrics", async () => {
    const { res, path, metrics } = await build();
    expect(path.replaceAll("\\", "/")).toMatch(/\/dashboards\/safety-dashboard-20261008-120000Z\.html$/);
    expect(res.summary).toContain(path);
    expect(res.untrusted).toBe(true);
    expect(metrics).toMatchObject({ open_actions: 3, overdue_actions: 2 });
    expect(typeof metrics.inspections_completed).toBe("number");
  });

  it("is self-contained: strict CSP, no external URLs except Mitti web app links", async () => {
    const { html } = await build();
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${DASHBOARD_CSP}">`);
    expect(DASHBOARD_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
    for (const url of html.match(/https?:\/\/[^\s"'<>)\\]+/gi) ?? []) expect(url.startsWith("https://app.safetyculture.com/")).toBe(true);
    expect(html).not.toMatch(/<link|<img|<iframe|@import|url\(|\bsrc=|@font-face/i);
    expect(html).not.toMatch(/["'(]\/\/[a-z0-9]/i); // no protocol-relative URLs
    expect(html).toContain("https://app.safetyculture.com/actions/a-1");
  });

  it("escapes record text: a <script> title never reaches the page as markup", async () => {
    const { html, data: d } = await build();
    expect(html).not.toContain(EVIL);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("\\u003cscript\\u003e");
    // the browser renderer escapes it too, in every view
    for (const v of renderer().VIEWS) {
      const out = renderAll(d, v);
      expect(out).not.toContain("<script");
      if (v === "actions" || v === "inspections") expect(out).toContain("&lt;script&gt;");
    }
    expect(embedJson({ a: "</script><b>&" })).toBe('{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
  });

  it("only renders links into the Mitti web app", () => {
    const d = buildDashboardData(stateCache(data()), { period: "last 90 days" }, NOW).data;
    d.open_actions.rows[0]!.href = "javascript:alert(1)";
    const out = renderAll(d as DashboardData, "actions");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="https://app.safetyculture.com/actions/');
  });

  it("strict privacy pseudonymises inspector names (and contact mode keeps them)", async () => {
    const strict = await build(stateCache(data()), "strict");
    const rows = strict.data.slices["90d|all"]!.team.inspector_rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.inspector_name).toMatch(/^person_[0-9a-f]{10}$/);
    expect(strict.html).not.toContain("Alex Demo");
    expect(strict.html).not.toContain("Sam Sample");
    const contact = await build(stateCache(data()), "contact");
    expect(contact.html).toContain("Alex Demo");
  });
});

describe("dashboard numbers are the analytics' numbers", () => {
  const c = stateCache(data());
  const { data: d } = buildDashboardData(c, { period: "last 90 days" }, NOW);
  const s = d.slices["90d|all"]!;
  const P = "last 90 days";

  it("overview tiles = safety pulse", () => {
    const pulse = safetyPulse(c, { period: P }, NOW).result;
    for (const t of s.overview.tiles) {
      const row = pulse.table.find((r) => r.metric === t.key);
      if (row) expect(t.value).toBe(row.current);
    }
    expect(s.overview.tiles.find((t) => t.key === "failed_item_rate")!.value).toBe(pulse.metrics.failed_item_rate);
    expect(s.overview.attention.map((a) => a.text)).toEqual(pulse.attention.map((a) => a.detail));
  });

  it("Pareto rows = analyzeFailedItems (item and template)", () => {
    const f = analyzeFailedItems(c, { period: P, group_by: "item", top: 15 }, NOW).result;
    expect(s.inspections.failed).toBe(f.metrics.failed_items);
    expect(s.inspections.rows.map((r) => [r.label, r.failed, r.cumulative])).toEqual(f.table.map((r) => [r.group, r.failed, r.cumulative_share_pct]));
    const t = analyzeFailedItems(c, { period: P, group_by: "template", top: 25 }, NOW).result;
    expect(s.team.templates.map((r) => r.rate)).toEqual(t.table.map((r) => r.failure_rate_pct));
  });

  it("actions = analyzeActionBacklog, and one dot per open action", () => {
    const b = analyzeActionBacklog(c, { period: P }, NOW).result;
    expect(s.actions.metrics).toEqual(b.metrics);
    expect(s.actions.weekly).toEqual(b.weekly);
    expect(d.open_actions.rows).toHaveLength(Number(b.metrics.open));
  });

  it("schedules = analyzeScheduleCompliance, including every weekly stripe", () => {
    const m = analyzeScheduleCompliance(c, { period: P }, NOW).result.metrics;
    expect(s.schedules.metrics).toEqual(m);
    const weeks = scope(d).stripes.weeks;
    expect(weeks.length).toBeGreaterThan(50);
    for (const w of weeks) {
      const wm = analyzeScheduleCompliance(c, { period: `${w.from}..${w.to}` }, NOW).result.metrics;
      expect([w.due, w.on_time, w.late, w.missed, w.compliance_pct]).toEqual([wm.due ?? 0, wm.on_time ?? 0, wm.late ?? 0, wm.missed ?? 0, wm.compliance_pct ?? null]);
    }
  });

  it("sites = analyzeSiteLeague for this and the previous period", () => {
    const L = analyzeSiteLeague(c, { period: P, min_inspections: 5 }, NOW).result;
    const prev = previousPeriod(parsePeriod(P, NOW));
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const Lp = analyzeSiteLeague(c, { period: `${iso(prev.from.getTime())}..${iso(prev.to.getTime() - 86_400_000)}`, min_inspections: 5 }, NOW).result;
    const league = d.league["90d"]!;
    expect(league.rows.map((r) => [r.site, r.average_score, r.failed_item_rate])).toEqual(L.table.map((r) => [r.site, r.average_score, r.failed_item_rate]));
    for (const r of league.rows) expect(r.previous_average_score).toBe(Lp.table.find((x) => x.site === r.site)?.average_score ?? null);
  });

  it("trends and inspector activity = computeTrend / computeInspectorActivity", () => {
    const tr = computeTrend(c, { metric: "failed_item_rate", grain: "week", period: parsePeriod("last 90 days", NOW) }, NOW).result.table;
    expect(scope(d).trends.w!.failed_item_rate!.points.map((p) => p.value)).toEqual(tr.map((r) => r.value));
    const ia = computeInspectorActivity(c, { period: parsePeriod(P, NOW), limit: 50 }, NOW).result;
    expect(s.team.inspector_rows.map((r) => [r.inspector_name, r.inspections, r.failed_item_rate])).toEqual(ia.table.map((r) => [r.inspector_name, r.inspections, r.failed_item_rate]));
  });

  it("per-site slices equal the analytics run on the full cache with that site filter", () => {
    const opt = d.sites.find((o) => o.sk === siteKey("site-2"))!;
    expect(opt).toBeTruthy();
    for (const p of d.periods) {
      const slice = d.slices[`${p.key}|${opt.key}`]!;
      const pulse = safetyPulse(c, { period: p.text, site_ids: ["site-2"] }, NOW).result;
      expect(slice.overview.tiles.find((t) => t.key === "failed_item_rate")!.value).toBe(pulse.metrics.failed_item_rate);
      expect(slice.overview.tiles.find((t) => t.key === "inspections_completed")!.value).toBe(pulse.metrics.inspections_completed);
      const f = analyzeFailedItems(c, { period: p.text, site_ids: ["site-2"], group_by: "item", top: 15 }, NOW).result;
      expect(slice.inspections.rows.map((r) => r.failed)).toEqual(f.table.map((r) => r.failed));
      expect(slice.actions.metrics).toEqual(analyzeActionBacklog(c, { period: p.text, site_ids: ["site-2"] }, NOW).result.metrics);
    }
  });

  it("closed vs completed: closed_other = backlog closed_in_period - pulse actions_completed, both labelled", () => {
    const closed = Number(analyzeActionBacklog(c, { period: P }, NOW).result.metrics.closed_in_period);
    const completed = safetyPulse(c, { period: P }, NOW).result.metrics.actions_completed as number;
    expect(s.actions.completed_in_period).toBe(completed);
    expect(s.actions.closed_other).toBe(closed - completed);
    expect(s.actions.answer).toContain(`${closed} closed (${completed} completed, ${closed - completed} closed without completing, such as can't do)`);
    const out = renderAll(d, "actions");
    expect(out).toContain("Closed (completed or can&#39;t do)");
    expect(out).not.toContain("has a completion date");
  });

  it("recent movement is stated when it runs against the fitted direction", () => {
    const row = (bucket: string, value: number, partial = false) => ({ bucket, value, partial });
    const t = [row("2026-08-03", 6), row("2026-08-10", 5), row("2026-08-17", 4), row("2026-08-24", 2.5), row("2026-08-31", 4), row("2026-09-07", 5.7), row("2026-09-14", 9, true)];
    expect(recentMove(t, "%", "week")).toBe("rising since 24 Aug (2.5% to 5.7%)");
    expect(recentMove([row("2026-08-03", 5), row("2026-08-10", 5.1), row("2026-08-17", 5), row("2026-08-24", 5.1)], "%", "week")).toBeNull();
  });

  it("the people headline leads with a very-fast outlier without naming them", () => {
    const team = s.team;
    if (team.outlier_index !== null) {
      const r = team.inspector_rows[team.outlier_index]!;
      expect(r.very_fast_share).toBeGreaterThanOrEqual(50);
      expect(team.answer).toMatch(/^One inspector stands out/);
      expect(team.answer).not.toContain(String(r.inspector_name));
    } else expect(team.answer).not.toMatch(/stands out/);
  });

  it("precomputes every period preset x every site, and adds a requested custom period", () => {
    expect(d.periods.map((p) => p.key)).toEqual(["7d", "30d", "90d", "12m"]);
    expect(Object.keys(d.slices)).toHaveLength(4 * (1 + d.sites.length));
    const custom = buildDashboardData(c, { period: "2026-07-01..2026-08-31" }, NOW).data;
    expect(custom.default_period).toBe("custom");
    expect(custom.periods.map((p) => p.key)).toContain("custom");
  });

  it("the renderer draws every view for every slice without throwing, at desktop and phone widths", () => {
    const R = renderer();
    // every view x period x site, plus a sparse organisation where most charts have nothing to draw
    const sparse = buildDashboardData(stateCache({ ...data(), actions: [], schedule_occurrences: [], inspections: data().inspections!.slice(0, 3) }), {}, NOW).data;
    for (const dd of [d, sparse])
      for (const v of R.VIEWS)
        for (const p of dd.periods)
          for (const sk of ["all", ...dd.sites.map((o) => o.key)])
            for (const w of [1100, 330]) {
            const out = R.view(dd, { view: v, period: p.key, site: sk, sort: {} }, ENV);
            for (const f of Object.values(out.charts)) if (f) expect(() => f(w)).not.toThrow();
          }
  });
});

describe("dashboard fails closed", () => {
  for (const u of UNUSABLE) {
    it(`actions feed ${u.name}: "Unavailable" with the reason, never 0`, async () => {
      const { data: d, metrics, html } = await build(stateCache(data(), "actions", u));
      expect(metrics.open_actions).toBeNull();
      expect(metrics.overdue_actions).toBeNull();
      expect(d.open_actions.unavailable).toMatch(u.reason);
      const s = d.slices["90d|all"]!;
      expect(s.actions.unavailable).toMatch(u.reason);
      const od = s.overview.tiles.find((t) => t.key === "open_overdue_actions")!;
      expect(od.value).toBeNull();
      expect(od.unavailable).toMatch(u.reason);
      const view = renderAll(d, "actions");
      expect(view).toContain("Unavailable");
      expect(view).not.toMatch(/>0 open actions|<div class="v">0</);
      expect(renderAll(d, "overview")).toMatch(/Open overdue actions<\/div><div class="v na">Unavailable/);
      expect(html).not.toContain('"overdue":0');
    });
  }

  it("inspections feed unreadable: inspection tiles, calendar and league are unavailable", async () => {
    const u = UNUSABLE[0]!;
    const { data: d } = await build(stateCache(data(), "inspections", u));
    const s = d.slices["90d|all"]!;
    expect(s.overview.tiles.find((t) => t.key === "inspections_completed")!.value).toBeNull();
    expect(scope(d).calendar.unavailable).toMatch(u.reason);
    expect(d.league["90d"]!.unavailable).toMatch(u.reason);
    const out = renderAll(d, "overview");
    expect(out).toContain("Unavailable");
    expect(out).not.toMatch(/Inspections completed<\/div><div class="v">0/);
  });

  it("schedule feed unreadable says so (not 0% or 100%); synced and empty says nothing was scheduled", async () => {
    const broken = await build(stateCache(data(), "schedule_occurrences", UNUSABLE[0]!));
    expect(broken.data.slices["90d|all"]!.schedules.state).toBe("unavailable");
    expect(renderAll(broken.data, "schedules")).toContain("This is not 0% or 100% compliance");
    expect(broken.metrics.schedule_on_time_pct).toBeNull();
    const empty = await build(stateCache({ ...data(), schedule_occurrences: [] }));
    expect(empty.data.slices["90d|all"]!.schedules.state).toBe("empty");
    expect(empty.metrics.schedule_on_time_pct).toBeNull();
  });
});

describe("MCP Apps view", () => {
  it("serves the same renderer with no data baked in", () => {
    const html = dashboardAppHtml();
    expect(DASHBOARD_APP_URI).toMatch(/^ui:\/\//);
    expect(DASHBOARD_APP_MIME).toBe("text/html;profile=mcp-app");
    expect(html).toContain('<script type="application/json" id="dash-data"></script>');
    expect(html).toContain("ui/initialize");
    expect(html).toBe(renderDashboardHtml(null));
  });

  it("client script parses and never contains a template interpolation", () => {
    expect(() => new Function(CLIENT_JS)).not.toThrow();
    expect(CLIENT_JS).not.toContain("${");
    expect(CLIENT_JS).not.toMatch(/<\/script/i);
  });
});
