import { describe, expect, it } from "vitest";
import { buckets, computeTrend, lastYear, olsSlope } from "../../src/analytics/trend.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, issue, item } from "../reports/fixtures.js";

const SIX = parsePeriod("2026-04-01..2026-09-30", NOW);

/** Apr 1, May 2, Jun 3, Jul 4, Aug 5, Sep 6 completed inspections (21), plus noise that must be ignored. */
function monthlyCache() {
  const rows: Record<string, unknown>[] = [];
  const months = ["04", "05", "06", "07", "08", "09"];
  months.forEach((m, mi) => {
    for (let k = 0; k <= mi; k++) rows.push(insp(`audit_m${m}k${k}`, { tpl: "template_t1", completed: `2026-${m}-1${k}T09:00:00.000Z`, score: 80 + k * 10 > 100 ? 100 : 80 + k * 10 }));
  });
  rows.push(insp("audit_arch", { tpl: "template_t1", completed: "2026-05-05T09:00:00.000Z", archived: true }));
  rows.push(insp("audit_open", { tpl: "template_t1", completed: null }));
  rows.push(insp("audit_other_site", { tpl: "template_t1", site: "site-2", completed: "2026-06-02T09:00:00.000Z" }));
  // last year: one in March 2025 (makes 2025-04 "available" with 0), one in May 2025
  rows.push(insp("audit_ly1", { tpl: "template_t1", completed: "2025-03-20T09:00:00.000Z" }));
  rows.push(insp("audit_ly2", { tpl: "template_t1", completed: "2025-05-10T09:00:00.000Z" }));
  return new FakeCache().seed("inspections", rows);
}

describe("buckets", () => {
  it("weeks start on Monday and are clipped to the period", () => {
    const p = parsePeriod("2026-09-02..2026-09-20", NOW); // Wed 2 Sep .. Sun 20 Sep
    const b = buckets(p, "week");
    expect(b.map((x) => x.label)).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(b.map((x) => x.partial)).toEqual([true, false, false]);
    expect(new Date(b[0]!.from).toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });
  it("months; same bucket last year", () => {
    const b = buckets(SIX, "month");
    expect(b.map((x) => x.label)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(b.every((x) => !x.partial)).toBe(true);
    const ly = lastYear(b[1]!, "month");
    expect(new Date(ly.from).toISOString()).toBe("2025-05-01T00:00:00.000Z");
    expect(new Date(ly.to).toISOString()).toBe("2025-06-01T00:00:00.000Z");
    const w = buckets(parsePeriod("2026-09-07..2026-09-13", NOW), "week")[0]!;
    expect(new Date(lastYear(w, "week").from).getUTCDay()).toBe(1); // still a Monday
  });
  it("OLS slope", () => {
    expect(olsSlope([[0, 1], [1, 2], [2, 3]])).toBe(1);
    expect(olsSlope([[0, 5], [1, 5]])).toBe(0);
  });
});

describe("computeTrend", () => {
  it("counts completed, non-archived inspections per month with a stated rising trend", () => {
    const { result, summary } = computeTrend(monthlyCache(), { metric: "inspections_completed", grain: "month", period: SIX, site_ids: ["site-1"] }, NOW);
    expect(result.table.map((r) => r.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.table.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.metrics.total).toBe(21);
    expect(result.metrics.slope_per_bucket).toBe(1);
    expect(result.metrics.direction).toBe("rising");
    expect(summary).toContain("21 in total");
    // last year: 2025-03-20 is the earliest record, so every 2025 month from April is available
    expect(result.table[0]!.last_year_value).toBe(0);
    expect(result.table[1]!.last_year_value).toBe(1);
    expect(result.table[1]!.last_year_n).toBe(1);
  });

  it("without the site filter the other-site inspection is counted", () => {
    const { result } = computeTrend(monthlyCache(), { metric: "inspections_completed", grain: "month", period: SIX }, NOW);
    expect(result.table[2]!.value).toBe(4);
  });

  it("last year is unavailable when the cache does not reach back", () => {
    const c = new FakeCache().seed("inspections", [insp("audit_x", { tpl: "template_t1", completed: "2026-05-02T00:00:00.000Z" })]);
    const { result } = computeTrend(c, { metric: "inspections_completed", grain: "month", period: SIX }, NOW);
    expect(result.table.every((r) => r.last_year_value === null)).toBe(true);
    expect(result.caveats.some((c2) => c2.includes("does not go back"))).toBe(true);
  });

  it("does not state a direction with fewer than 6 usable buckets", () => {
    const p = parsePeriod("2026-09-07..2026-09-27", NOW);
    const { result } = computeTrend(monthlyCache(), { metric: "inspections_completed", grain: "week", period: p }, NOW);
    expect(result.table).toHaveLength(3);
    expect(String(result.metrics.direction)).toMatch(/^not stated \(only 3 usable weeks/);
    expect(result.metrics.slope_per_bucket).not.toBeNull();
  });

  it("partial buckets are flagged and excluded from count slopes", () => {
    const p = parsePeriod("last 6 months", NOW); // 2026-04-09 .. 2026-10-08
    const { result } = computeTrend(monthlyCache(), { metric: "inspections_completed", grain: "month", period: p }, NOW);
    expect(result.table.map((r) => r.bucket)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(result.table[0]!.partial).toBe(true);
    expect(result.table[6]!.partial).toBe(true);
    expect(result.table[0]!.value).toBe(1); // 2026-04-10 is inside the clipped bucket
    expect(result.metrics.fitted_buckets).toBe(5);
    expect(String(result.metrics.direction)).toContain("not stated");
  });

  it("average score uses scored inspections only", () => {
    const c = new FakeCache().seed("inspections", [
      insp("audit_s1", { tpl: "template_t1", completed: "2026-09-02T00:00:00.000Z", score: 80 }),
      insp("audit_s2", { tpl: "template_t1", completed: "2026-09-03T00:00:00.000Z", score: 90 }),
      insp("audit_s3", { tpl: "template_t1", completed: "2026-09-04T00:00:00.000Z" }), // unscored
    ]);
    const { result } = computeTrend(c, { metric: "average_score", grain: "month", period: parsePeriod("2026-09", NOW) }, NOW);
    expect(result.table[0]).toMatchObject({ value: 85, n: 2 });
  });

  it("failed-item rate = failed / answered, ignoring blanks, sections and inactive items", () => {
    const c = new FakeCache()
      .seed("inspections", [insp("audit_f1", { tpl: "template_t1", completed: "2026-09-02T00:00:00.000Z" })])
      .seed("inspection_items", [
        item("audit_f1", "Q1", { response: "No", failed: true }),
        item("audit_f1", "Q2"),
        item("audit_f1", "Q3"),
        item("audit_f1", "Q4", { type: "text", response: "ok" }),
        item("audit_f1", "Q5", { response: "" }),
        item("audit_f1", "Section A", { type: "section", response: "" }),
        item("audit_f1", "Hidden", { inactive: true, response: "No", failed: true }),
      ]);
    const { result } = computeTrend(c, { metric: "failed_item_rate", grain: "month", period: parsePeriod("2026-09", NOW) }, NOW);
    expect(result.table[0]).toMatchObject({ value: 25, n: 4 });
  });

  it("issues and actions by their own dates and scope", () => {
    const c = new FakeCache()
      .seed("issues", [issue("i1", { created: "2026-09-02T00:00:00Z" }), issue("i2", { created: "2026-09-03T00:00:00Z", site: "site-2" }), issue("i3", { created: "2026-08-03T00:00:00Z" })])
      .seed("actions", [
        action("a1", { created: "2026-09-01T00:00:00Z", completed: "2026-09-05T00:00:00Z", status: "Complete" }),
        action("a2", { created: "2026-08-01T00:00:00Z", completed: "2026-09-06T00:00:00Z", status: "Complete" }),
        action("a3", { created: "2026-09-10T00:00:00Z" }),
      ]);
    const sep = parsePeriod("2026-09", NOW);
    expect(computeTrend(c, { metric: "issues_created", grain: "month", period: sep, site_ids: ["site-1"] }, NOW).result.table[0]!.value).toBe(1);
    expect(computeTrend(c, { metric: "actions_created", grain: "month", period: sep }, NOW).result.table[0]!.value).toBe(2);
    expect(computeTrend(c, { metric: "actions_completed", grain: "month", period: sep }, NOW).result.table[0]!.value).toBe(2);
  });
});
