import { describe, expect, it } from "vitest";
import { analyzeCompare } from "../../src/analytics/compare.js";
import { analyzeSiteLeague } from "../../src/analytics/league.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");

function insp(id: string, site: string, day: string, score: number) {
  return { id, archived: false, date_completed: `${day}T09:00:00Z`, site_id: site, template_id: "template_t1", score_percentage: score, max_score: 10 };
}
function items(auditId: string, answered: number, failed: number) {
  return Array.from({ length: answered }, (_, i) => ({
    id: `${auditId}-${i}`,
    audit_id: auditId,
    template_id: "template_t1",
    label: `Q${i}`,
    type: "question",
    response: "x",
    is_failed_response: i < failed,
  }));
}

function leagueFixture() {
  // September: A 4 inspections @90, 10 answered / 1 failed; B 2 @70, 10 answered / 3 failed; C 1 inspection (below min)
  // August (previous period): A 2 @60, B 3 @95, no items
  const inspections = [
    insp("audit_a1", "site-a", "2026-09-02", 90),
    insp("audit_a2", "site-a", "2026-09-03", 90),
    insp("audit_a3", "site-a", "2026-09-04", 90),
    insp("audit_a4", "site-a", "2026-09-05", 90),
    insp("audit_b1", "site-b", "2026-09-02", 70),
    insp("audit_b2", "site-b", "2026-09-03", 70),
    insp("audit_c1", "site-c", "2026-09-02", 50),
    insp("audit_pa1", "site-a", "2026-08-10", 60),
    insp("audit_pa2", "site-a", "2026-08-11", 60),
    insp("audit_pb1", "site-b", "2026-08-10", 95),
    insp("audit_pb2", "site-b", "2026-08-11", 95),
    insp("audit_pb3", "site-b", "2026-08-12", 95),
  ];
  return new FakeCache()
    .seed("inspections", inspections)
    .seed("inspection_items", [...items("audit_a1", 5, 1), ...items("audit_a2", 5, 0), ...items("audit_b1", 5, 2), ...items("audit_b2", 5, 1)])
    .seed("actions", [
      { id: "x1", status: "Complete", site_id: "site-a", created_at: "2026-09-01T00:00:00Z", due_date: "2026-09-02T00:00:00Z", completed_at: "2026-09-03T00:00:00Z" },
      { id: "x2", status: "Complete", site_id: "site-b", created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-11T00:00:00Z" },
      { id: "x3", status: "To Do", site_id: "site-b", created_at: "2026-09-05T00:00:00Z", due_date: "2026-09-10T00:00:00Z" },
    ])
    .seed("sites", [
      { id: "site-a", name: "Demo North" },
      { id: "site-b", name: "Demo South" },
      { id: "site-c", name: "Demo West" },
    ]);
}

describe("analyzeSiteLeague", () => {
  it("ranks by equal-weight signed z-scores and lists low-volume sites separately", () => {
    const { result } = analyzeSiteLeague(leagueFixture(), { period: "2026-09-01..2026-09-30", min_inspections: 2 }, NOW);
    expect(result.table.map((r) => [r.rank, r.site, r.inspections, r.average_score, r.failed_item_rate, r.overdue_actions, r.median_resolution_days, r.composite])).toEqual([
      [1, "Demo North", 4, 90, 10, 0, 2, 1],
      [2, "Demo South", 2, 70, 30, 1, 10, -1],
    ]);
    expect(result.below_minimum).toEqual([{ site: "Demo West", site_id: "site-c", inspections: 1, reason: "1 completed inspections, below the minimum of 2." }]);
  });

  it("rank change vs the previous period (previous rank minus current rank)", () => {
    const { result } = analyzeSiteLeague(leagueFixture(), { period: "2026-09-01..2026-09-30", min_inspections: 2 }, NOW);
    expect(result.table.map((r) => [r.site, r.previous_rank, r.rank_change])).toEqual([
      ["Demo North", 2, 1],
      ["Demo South", 1, -1],
    ]);
  });

  it("previous-period rank ignores open overdue actions, whose earlier state the cache cannot reconstruct", () => {
    // Site A has an action that was overdue on 31 Aug but whose due date was later extended to November.
    // Previous-period scores tie, so before the fix the current due date alone decided August's rank.
    const fixture = (due: string) =>
      new FakeCache()
        .seed("inspections", [
          insp("audit_a1", "site-a", "2026-09-02", 90),
          insp("audit_b1", "site-b", "2026-09-02", 70),
          insp("audit_pa1", "site-a", "2026-08-10", 80),
          insp("audit_pb1", "site-b", "2026-08-10", 80),
        ])
        .seed("inspection_items", [])
        .seed("actions", [{ id: "x9", status: "To Do", site_id: "site-a", created_at: "2026-08-01T00:00:00Z", due_date: due }])
        .seed("sites", [
          { id: "site-a", name: "Demo North" },
          { id: "site-b", name: "Demo South" },
        ]);
    const run = (due: string) =>
      analyzeSiteLeague(fixture(due), { period: "2026-09-01..2026-09-30", min_inspections: 1, metrics: ["average_score", "overdue_actions"] }, NOW).result;
    const extended = run("2026-11-15T00:00:00Z");
    const original = run("2026-08-15T00:00:00Z");
    const ranks = (r: typeof extended) => r.table.map((x) => [x.site, x.previous_rank, x.rank_change]);
    expect(ranks(original)).toEqual(ranks(extended));
    expect(ranks(extended)).toEqual([
      ["Demo North", 1, 0],
      ["Demo South", 2, 0],
    ]);
    expect(extended.caveats.some((c) => c.includes("Previous-period rank leaves out open overdue actions"))).toBe(true);

    const onlyOverdue = analyzeSiteLeague(fixture("2026-08-15T00:00:00Z"), { period: "2026-09-01..2026-09-30", min_inspections: 1, metrics: ["overdue_actions"] }, NOW).result;
    expect(onlyOverdue.table.every((x) => x.previous_rank === null && x.rank_change === null)).toBe(true);
    expect(onlyOverdue.caveats.some((c) => c.startsWith("No previous-period rank"))).toBe(true);
  });

  it("uses only the chosen metrics", () => {
    const { result } = analyzeSiteLeague(leagueFixture(), { period: "2026-09-01..2026-09-30", min_inspections: 2, metrics: ["failed_item_rate"] }, NOW);
    expect(result.table.map((r) => [r.site, r.composite])).toEqual([
      ["Demo North", 1],
      ["Demo South", -1],
    ]);
    expect(result.metrics.metrics_used).toBe("failed_item_rate");
  });

  it("default minimum of 10 leaves nobody ranked and says so", () => {
    const { result, summary } = analyzeSiteLeague(leagueFixture(), { period: "2026-09-01..2026-09-30" }, NOW);
    expect(result.table).toEqual([]);
    expect(result.below_minimum).toHaveLength(3);
    expect(summary).toContain("No site reached 10 completed inspections");
  });
});

function compareFixture() {
  // September: 25 inspections x 4 answered = 100, 45 failed. August: 100 answered, 30 failed. All scores 80.
  const inspections: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  let failS = 45;
  let failA = 30;
  for (let i = 0; i < 25; i++) {
    inspections.push(insp(`audit_s${i}`, i % 2 ? "site-a" : "site-b", `2026-09-${String(1 + (i % 28)).padStart(2, "0")}`, 80));
    inspections.push(insp(`audit_g${i}`, "site-a", `2026-08-${String(1 + (i % 28)).padStart(2, "0")}`, 80));
    const fs = Math.min(4, failS);
    failS -= fs;
    const fa = Math.min(4, failA);
    failA -= fa;
    its.push(...items(`audit_s${i}`, 4, fs), ...items(`audit_g${i}`, 4, fa));
  }
  return new FakeCache().seed("inspections", inspections).seed("inspection_items", its).seed("actions", []).seed("sites", []);
}

describe("analyzeCompare", () => {
  it("periods: two-proportion test on failed-item rate matches the reference (45/100 vs 30/100)", () => {
    const { result, summary } = analyzeCompare(compareFixture(), { period_a: "2026-09", period_b: "2026-08" }, NOW);
    const [fr, sc, rs] = result.table;
    expect(fr).toMatchObject({ measure: "failed_item_rate", a_value: 45, b_value: 30, a_n: 100, b_n: 100, verdict: "real difference" });
    expect(fr!.statistic).toBeCloseTo(2.1909, 3);
    expect(fr!.p_value).toBeCloseTo(0.0285, 3);
    expect(sc).toMatchObject({ measure: "average_score", a_value: 80, b_value: 80, a_n: 25, b_n: 25, verdict: "probably noise" });
    expect(rs).toMatchObject({ measure: "action_resolution_days", a_n: 0, b_n: 0, verdict: "not enough data" });
    expect(fr!.explanation).toContain("unlikely to be chance");
    expect(summary).toContain("failed-item rate 45% vs 30% (real difference)");
    expect(result.caveats.some((c) => c.includes("not independent"))).toBe(true);
  });

  it("periods: default period_b is the previous equal-length period", () => {
    const { result } = analyzeCompare(compareFixture(), { period_a: "2026-09-01..2026-09-30" }, NOW);
    expect(result.metrics.b_period).toContain("2026-08-02 to 2026-08-31");
  });

  it("sites: compares two site groups over one period; overlapping groups are rejected", () => {
    const { result } = analyzeCompare(compareFixture(), { site_ids_a: ["site-a"], site_ids_b: ["site-b"], period_a: "2026-09" }, NOW);
    expect(result.filters.mode).toBe("sites");
    // site-a holds the odd-numbered September inspections (12), site-b the even ones (13)
    expect(result.metrics).toMatchObject({ a_inspections: 12, b_inspections: 13 });
    expect(() => analyzeCompare(compareFixture(), { site_ids_a: ["site-a"], site_ids_b: ["site-a"] }, NOW)).toThrow(/overlap/);
  });

  it("small samples give 'not enough data'", () => {
    const { result } = analyzeCompare(leagueFixture(), { site_ids_a: ["site-a"], site_ids_b: ["site-b"], period_a: "2026-09" }, NOW);
    expect(result.table.map((r) => r.verdict)).toEqual(["not enough data", "not enough data", "not enough data"]);
  });
});
