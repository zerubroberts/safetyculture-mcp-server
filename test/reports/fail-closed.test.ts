import { describe, expect, it } from "vitest";
import type { FeedName } from "../../src/cache/contract.js";
import type { CacheReader } from "../../src/cache/contract.js";
import { buildAuditPack, buildSafetyPulse, buildSiteScorecard, type Built } from "../../src/reports/build.js";
import { renderHtml } from "../../src/reports/html.js";
import { renderMarkdown } from "../../src/reports/markdown.js";
import { overdueActions, topFailedItems } from "../../src/reports/sections.js";
import type { Tile } from "../../src/reports/model.js";
import { UNUSABLE, stateCache } from "../analytics/feed-states.js";
import { NOW, action, insp, issue, item, site } from "./fixtures.js";

/**
 * Reports fail closed: a figure whose feed cannot be read renders as "unavailable" with the reason,
 * never as the word "null" and never as 0. Empty-but-synced feeds still render true zeros.
 */

const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function data(): Partial<Record<FeedName, Record<string, unknown>[]>> {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let k = 0; k < 30; k++) {
    const id = `audit_r${k}`;
    inspections.push(insp(id, { tpl: "template_t1", site: "site-1", owner: "user_a", completed: DAYS(1 + (k % 25)), score: 90, duration: 600 }));
    items.push(item(id, "Guard fitted", { response: "No", failed: true }), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
  }
  return {
    inspections,
    inspection_items: items,
    actions: [
      action("a-1", { priority: "HIGH", created: DAYS(60), due: DAYS(20) }),
      action("a-2", { priority: "LOW", created: DAYS(10), due: DAYS(2) }),
      action("a-3", { status: "COMPLETE", created: DAYS(40), completed: DAYS(5) }),
    ],
    issues: [issue("i-1", { category: "Slip", created: DAYS(3), priority: "High" })],
    schedule_occurrences: [{ id: "o1", template_id: "template_t1", due_time: DAYS(4), occurrence_status: "COMPLETED" }],
    sites: [site("site-1", "Depot")],
    templates: [{ id: "template_t1", name: "Pre-start" }],
    users: [],
  };
}

const REPORTS: Array<{ name: string; build: (c: CacheReader) => Built }> = [
  { name: "weekly safety pulse", build: (c) => buildSafetyPulse(c, { period: "last 30 days" }, NOW) },
  { name: "audit evidence pack", build: (c) => buildAuditPack(c, {}, NOW) },
  { name: "site scorecard", build: (c) => buildSiteScorecard(c, { site_id: "site-1" }, NOW) },
];

/** Per broken feed: the returned metrics that must be null, and rendered text that would be a fabricated zero. */
const FEEDS: Array<{ feed: FeedName; metrics: string[]; zeros: RegExp[]; tiles: string[] }> = [
  {
    feed: "actions",
    metrics: ["overdue_actions", "open_actions"],
    zeros: [/\| Open overdue actions \| 0 \|/, /\| Actions (created|completed) \| 0 \|/, /\| (Open actions|Overdue|Opened in period|Closed in period) \| 0 \|/, /\b0 open actions/, /\b0 open, 0 overdue/, /No overdue actions/, /No open actions/],
    tiles: ["Actions created", "Actions completed", "Open overdue actions"],
  },
  {
    feed: "inspection_items",
    metrics: ["failed_item_rate", "failed_answers"],
    zeros: [/\| Failed-item rate \| 0%/, /0 failed of 0 answered/, /\b0 failed answers/, /No failed items in this period/],
    tiles: ["Failed-item rate"],
  },
  {
    feed: "inspections",
    metrics: ["inspections_completed", "average_score", "failed_item_rate", "failed_answers"],
    zeros: [/\| Inspections completed \| 0 \|/, /\| Average score \| 0%/, /\b0 inspections/, /No data in this period/, /No completed inspections at this site/, /No failed items in this period/],
    tiles: ["Inspections completed", "Average score", "Failed-item rate"],
  },
];

const tilesOf = (b: Built): Tile[] => b.report.sections.flatMap((s) => s.blocks.flatMap((bl) => (bl.kind === "kpis" ? bl.tiles : [])));

describe("reports fail closed", () => {
  for (const r of REPORTS)
    for (const f of FEEDS)
      for (const u of UNUSABLE)
        it(`${r.name}: ${f.feed} feed ${u.name} renders "unavailable", no "null", no fabricated 0`, () => {
          const built = r.build(stateCache(data(), f.feed, u));
          const html = renderHtml(built.report);
          const md = renderMarkdown(built.report);
          for (const out of [html, md]) {
            expect(out).toMatch(/unavailable/);
            expect(out).toMatch(u.reason);
            expect(out).not.toMatch(/\bnull\b/);
            for (const z of f.zeros) expect(out).not.toMatch(z);
          }
          expect(built.summary).not.toMatch(/\bnull\b/);
          for (const z of f.zeros) expect(built.summary).not.toMatch(z);
          for (const k of f.metrics) if (k in built.metrics) expect(built.metrics[k], k).toBeNull();
          // Withheld KPI tiles show n/a with a short reason line.
          const tiles = tilesOf(built);
          for (const label of f.tiles) {
            const t = tiles.find((x) => x.label === label);
            expect(t, label).toBeDefined();
            expect(t!.value, label).toBeNull();
            expect(t!.note, label).toMatch(/^unavailable: /);
          }
          expect(md).toMatch(new RegExp(`\\| ${f.tiles[0]} \\| n/a \\| unavailable: `));
        });

  for (const r of REPORTS)
    it(`${r.name}: healthy feeds render no "unavailable" and no "null"`, () => {
      const built = r.build(stateCache(data()));
      const md = renderMarkdown(built.report);
      expect(md).not.toMatch(/unavailable/);
      expect(md).not.toMatch(/\bnull\b/);
    });

  it("successfully synced empty feeds still render true zeros", () => {
    const c = stateCache({ ...data(), actions: [], inspections: [], inspection_items: [] });
    const pulse = buildSafetyPulse(c, { period: "last 30 days" }, NOW);
    const md = renderMarkdown(pulse.report);
    expect(pulse.metrics).toMatchObject({ inspections_completed: 0, overdue_actions: 0 });
    expect(md).toMatch(/\| Inspections completed \| 0 \|/);
    expect(md).toMatch(/\| Open overdue actions \| 0 \| snapshot now \|/);
    expect(md).toContain("0 open actions are past their due date.");
    expect(md).not.toMatch(/unavailable/);
    const audit = buildAuditPack(c, {}, NOW);
    expect(audit.metrics).toMatchObject({ open_actions: 0, overdue_actions: 0, failed_answers: 0, inspections_completed: 0 });
    expect(renderMarkdown(audit.report)).toMatch(/\| Open actions \| 0 \|/);
  });
});

describe("report sections fail closed", () => {
  it("topFailedItems keeps null totals instead of coercing them to 0", () => {
    const f = topFailedItems(stateCache(data(), "inspection_items", UNUSABLE[0]), "last 30 days", undefined, 10, NOW);
    expect(f.totalFailed).toBeNull();
    expect(f.totalAnswered).toBeNull();
    expect(f.rows).toEqual([]);
    expect(f.unavailable).toMatch(/^Failed-item figures unavailable: the inspection_items feed could not be read \(HTTP 403: no permission\)/);
    const ok = topFailedItems(stateCache(data()), "last 30 days", undefined, 10, NOW);
    expect(ok).toMatchObject({ totalFailed: 30, totalAnswered: 120, unavailable: null });
  });

  for (const u of UNUSABLE)
    it(`overdueActions checks the actions feed first (${u.name})`, () => {
      const o = overdueActions(stateCache(data(), "actions", u), undefined, NOW);
      expect(o.rows).toEqual([]);
      expect(o.unavailable).toMatch(/^Action figures unavailable: the actions feed /);
      expect(o.unavailable).toMatch(u.reason);
    });

  it("coverage table marks unreadable feeds unavailable, not partial", () => {
    const md = renderMarkdown(buildSafetyPulse(stateCache(data(), "actions", UNUSABLE[2]), {}, NOW).report);
    expect(md).toMatch(/\| actions \| 3 \| [^|]+ \| unavailable \|/);
    expect(md).not.toMatch(/\| actions \|[^\n]*partial/);
  });
});
