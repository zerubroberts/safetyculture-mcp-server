import { describe, expect, it } from "vitest";
import { computeStalls, statusFromItemData } from "../../src/analytics/stalls.js";
import { computeHotspots } from "../../src/analytics/hotspots.js";
import { ACTION_STATUS } from "../../src/toolsets/actions.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, issue, site, timeline } from "../reports/fixtures.js";

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const A3 = "33333333-3333-4333-8333-333333333333";

/**
 * A1 (high, complete): created 09-01, in_progress 09-03, due re-dated 09-05, reassigned 09-10, complete 09-21.
 *    to_do 2d, in_progress 18d, longest gap 11d (09-10 -> 09-21). Set-up events in the first minute ignored.
 * A2 (medium, to do, no timeline): created 09-28T12:00 -> 10 days in to_do until now.
 * A3 (low, in progress, site-2): created 08-01T12:00, in_progress 08-11T12:00 -> 10d to_do, 58d in_progress;
 *    plus a status event with unreadable data.
 */
function stallCache() {
  return new FakeCache()
    .seed("actions", [
      action(A1, { priority: "HIGH", status: "COMPLETE", created: "2026-09-01T00:00:00.000Z", completed: "2026-09-21T00:00:00.000Z" }),
      action(A2, { priority: "MEDIUM", status: "TODO", created: "2026-09-28T12:00:00.000Z" }),
      action(A3, { priority: "LOW", status: "IN_PROGRESS", site: "site-2", created: "2026-08-01T12:00:00.000Z" }),
    ])
    .seed("action_timeline_items", [
      timeline(A1, "TASK_CREATED", "2026-09-01T00:00:00.000Z"),
      timeline(A1, "TASK_DUE_AT_UPDATED", "2026-09-01T00:00:10.000Z", { due_at: "2026-09-08T00:00:00Z" }),
      timeline(A1, "TASK_ASSIGNEE_ADDED", "2026-09-01T00:00:30.000Z"),
      timeline(A1, "TASK_STATUS_UPDATED", "2026-09-03T00:00:00.000Z", { status_id: ACTION_STATUS.in_progress }),
      timeline(A1, "TASK_DUE_AT_UPDATED", "2026-09-05T00:00:00.000Z", { due_at: "2026-09-15T00:00:00Z" }),
      timeline(A1, "TASK_ASSIGNEE_UPDATED", "2026-09-10T00:00:00.000Z"),
      timeline(A1, "TASK_STATUS_UPDATED", "2026-09-21T00:00:00.000Z", { task_status_updated_data: { status_id: ACTION_STATUS.complete } }),
      timeline(A3, "task_status_updated", "2026-08-11T12:00:00.000Z", { status_id: ACTION_STATUS.in_progress }),
      timeline(A3, "TASK_COMMENT_ADDED", "2026-08-20T12:00:00.000Z", { comment: "checking" }),
    ]);
}

describe("statusFromItemData", () => {
  it("reads system status ids and labels, rejects unknown text", () => {
    expect(statusFromItemData(JSON.stringify({ status_id: ACTION_STATUS.cant_do }))).toBe("cant_do");
    expect(statusFromItemData(JSON.stringify({ status: { label: "In progress" } }))).toBe("in_progress");
    expect(statusFromItemData("Complete")).toBe("complete");
    expect(statusFromItemData("not json at all")).toBeUndefined();
    expect(statusFromItemData("")).toBeUndefined();
  });
});

describe("computeStalls", () => {
  it("replays time in status, gaps, re-dates and reassignments", () => {
    const { result } = computeStalls(stallCache(), { limit: 50 }, NOW);
    const r = (id: string) => result.table.find((x) => x.action_id === id)!;
    expect(r(A1)).toMatchObject({ status: "complete", priority: "high", days_open: 20, days_in_status: { to_do: 2, in_progress: 18 }, longest_gap_days: 11, status_changes: 2, due_date_changes: 1, reassignments: 1 });
    expect(r(A1).longest_gap_from).toBe("2026-09-10T00:00:00.000Z");
    expect(r(A2)).toMatchObject({ days_open: 10, days_in_status: { to_do: 10 }, longest_gap_days: 10, timeline_events: 0 });
    expect(r(A3)).toMatchObject({ days_in_status: { to_do: 10, in_progress: 58 }, longest_gap_days: 49 });
    expect(result.table.map((x) => x.action_id)).toEqual([A3, A1, A2]);
  });

  it("aggregates where actions stall", () => {
    const { result, summary } = computeStalls(stallCache(), { limit: 50 }, NOW);
    const by = (result as unknown as { by_status: Array<Record<string, unknown>> }).by_status;
    expect(by).toEqual([
      { status: "in_progress", actions: 2, total_days: 76, median_days: 38, share_of_open_time_pct: 77.6 },
      { status: "to_do", actions: 3, total_days: 22, median_days: 10, share_of_open_time_pct: 22.4 },
    ]);
    expect(result.metrics).toMatchObject({ actions: 3, open: 2, with_due_date_changes: 1, with_reassignments: 1, stalls_most_in: "in_progress" });
    expect(summary).toContain('"in_progress" (77.6% of 98 action-days)');
    expect(result.caveats.some((c) => c.startsWith("1 actions have no timeline items"))).toBe(true);
  });

  it("filters by priority, site and ids", () => {
    expect(computeStalls(stallCache(), { priority: ["high"], limit: 50 }, NOW).result.table.map((x) => x.action_id)).toEqual([A1]);
    expect(computeStalls(stallCache(), { site_ids: ["site-2"], limit: 50 }, NOW).result.table.map((x) => x.action_id)).toEqual([A3]);
    const byId = computeStalls(stallCache(), { action_ids: [A2.toUpperCase(), "44444444-4444-4444-8444-444444444444"], limit: 50 }, NOW).result;
    expect(byId.table.map((x) => x.action_id)).toEqual([A2]);
    expect(byId.caveats.some((c) => c.startsWith("1 requested action IDs are not in the cache"))).toBe(true);
  });

  it("counts an unreadable status change as unknown", () => {
    const c = stallCache();
    const rows = c.rows("action_timeline_items");
    c.seed("action_timeline_items", [...rows, timeline(A2, "TASK_STATUS_UPDATED", "2026-10-03T12:00:00.000Z", "??")]);
    const { result } = computeStalls(c, { action_ids: [A2], limit: 50 }, NOW);
    expect(result.table[0]!.days_in_status).toEqual({ to_do: 5, unknown: 5 });
    expect(result.caveats.some((x) => x.startsWith("1 status-change events had no readable new status"))).toBe(true);
  });
});

/**
 * September 2026 (previous period = 30 days before: 08-02 .. 08-31):
 *   site-1 has 4 completed inspections, site-2 none.
 *   Slip: 12 at site-1, 2 at site-2 (previous 5). Fire: 3 at site-1 + 1 with no site (previous 5). 1 uncategorised at site-1.
 */
function hotCache() {
  const issues: Record<string, unknown>[] = [];
  let n = 0;
  const add = (count: number, o: Parameters<typeof issue>[1]) => {
    for (let k = 0; k < count; k++) issues.push(issue(`iss-${n++}`, o));
  };
  add(12, { category: "Slip", site: "site-1", created: "2026-09-10T00:00:00Z" });
  add(2, { category: "Slip", site: "site-2", created: "2026-09-11T00:00:00Z" });
  add(3, { category: "Fire", site: "site-1", created: "2026-09-12T00:00:00Z" });
  add(1, { category: "Fire", site: null, created: "2026-09-13T00:00:00Z" });
  add(1, { category: null, site: "site-1", created: "2026-09-14T00:00:00Z" });
  add(5, { category: "Slip", site: "site-1", created: "2026-08-10T00:00:00Z" });
  add(5, { category: "Fire", site: "site-1", created: "2026-08-11T00:00:00Z" });
  add(3, { category: "Fire", site: "site-1", created: "2026-07-11T00:00:00Z" }); // before both periods
  const ins = [0, 1, 2, 3].map((k) => insp(`audit_h${k}`, { tpl: "template_t1", site: "site-1", completed: `2026-09-0${k + 1}T09:00:00.000Z` }));
  return new FakeCache().seed("issues", issues).seed("inspections", ins).seed("sites", [site("site-1", "Demo Depot"), site("site-2", "Sample Yard")]);
}

describe("computeHotspots", () => {
  const P = parsePeriod("2026-09", NOW);

  it("category x site with rate per 100 inspections", () => {
    const { result } = computeHotspots(hotCache(), { period: P, limit: 25 }, NOW);
    expect(result.table.map((r) => [r.category, r.site_name, r.issues, r.per_100_inspections])).toEqual([
      ["Slip", "Demo Depot", 12, 300],
      ["Fire", "Demo Depot", 3, 75],
      ["Slip", "Sample Yard", 2, null],
      ["(uncategorised)", "Demo Depot", 1, 25],
      ["Fire", "(no site)", 1, null],
    ]);
    expect(result.metrics).toMatchObject({ issues: 19, previous_period_issues: 10, categories: 3, rising_categories: 1 });
    expect(result.caveats.some((c) => c.startsWith("1 issues have no site"))).toBe(true);
  });

  it("rising categories need 10+ issues and growth", () => {
    const r = computeHotspots(hotCache(), { period: P, limit: 25 }, NOW).result as unknown as { rising: unknown[]; by_category: unknown[] };
    expect(r.rising).toEqual([{ category: "Slip", issues: 14, previous: 5, change: 9, change_pct: 180 }]);
    expect(r.by_category).toEqual([
      { category: "Slip", issues: 14, previous: 5, share_pct: 73.7 },
      { category: "Fire", issues: 4, previous: 5, share_pct: 21.1 },
      { category: "(uncategorised)", issues: 1, previous: 0, share_pct: 5.3 },
    ]);
  });

  it("site filter", () => {
    const { result } = computeHotspots(hotCache(), { period: P, site_ids: ["site-1"], limit: 25 }, NOW);
    expect(result.metrics.issues).toBe(16);
  });
});
