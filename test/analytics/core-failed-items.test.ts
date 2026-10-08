import { describe, expect, it } from "vitest";
import { analyzeFailedItems, isAnswered } from "../../src/analytics/failed-items.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");

// 12 inspections: 10 completed in period (site-1: insp-1..6, site-2: insp-7..10), 1 archived, 1 not completed.
// Each counted inspection has 4 answered questions -> 40 answered. Failures: Q1 in insp-1 and insp-2, Q2 in insp-7 -> 3.
function fixture() {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let n = 1; n <= 10; n++) {
    inspections.push({
      id: `audit_${n}`,
      archived: false,
      date_completed: `2026-09-${String(10 + n).padStart(2, "0")}T09:00:00Z`,
      site_id: n <= 6 ? "site-1" : "site-2",
      template_id: "template_t1",
      template_name: "Demo Walkthrough",
      owner_id: n % 2 ? "user_a" : "user_b",
      owner_name: n % 2 ? "Alex Demo" : "Blair Demo",
      score_percentage: 90,
      max_score: 10,
    });
    const q = (i: number, label: string, failed: boolean, response = failed ? "No" : "Yes") =>
      items.push({ id: `${n}-${i}`, audit_id: `audit_${n}`, template_id: "template_t1", label, response, type: "question", is_failed_response: failed, inactive: false });
    // label whitespace/case variants must collapse into one item identity
    q(1, n === 2 ? "  fire exit   CLEAR? " : "Fire exit clear?", n === 1 || n === 2);
    q(2, "Guards fitted?", n === 7, n === 7 ? "Missing guard" : "Yes");
    q(3, "Spill kit stocked?", false);
    q(4, "Signage visible?", false);
    // not answered: free text, a section header, an empty response, an inactive (hidden) failed item
    items.push({ id: `${n}-t`, audit_id: `audit_${n}`, template_id: "template_t1", label: "Notes", response: "all good", type: "text", is_failed_response: false });
    items.push({ id: `${n}-s`, audit_id: `audit_${n}`, template_id: "template_t1", label: "Section A", response: "", type: "section", is_failed_response: false });
    items.push({ id: `${n}-e`, audit_id: `audit_${n}`, template_id: "template_t1", label: "Unanswered", response: "", type: "question", is_failed_response: false });
    items.push({ id: `${n}-i`, audit_id: `audit_${n}`, template_id: "template_t1", label: "Hidden", response: "No", type: "question", is_failed_response: true, inactive: true });
  }
  inspections.push({ id: "audit_arch", archived: true, date_completed: "2026-09-20T09:00:00Z", site_id: "site-1", template_id: "template_t1" });
  inspections.push({ id: "audit_open", archived: false, date_completed: "", site_id: "site-1", template_id: "template_t1" });
  for (const id of ["audit_arch", "audit_open"])
    items.push({ id: `${id}-1`, audit_id: id, template_id: "template_t1", label: "Fire exit clear?", response: "No", type: "question", is_failed_response: true });
  return new FakeCache()
    .seed("inspections", inspections)
    .seed("inspection_items", items)
    .seed("sites", [
      { id: "site-1", name: "Demo Depot" },
      { id: "site-2", name: "Demo Yard" },
    ])
    .seed("templates", [{ id: "template_t1", name: "Demo Walkthrough" }])
    .seed("users", []);
}

describe("analyzeFailedItems", () => {
  it("counts 3 failed of 40 answered and builds an exact Pareto by item", () => {
    const { result, summary } = analyzeFailedItems(fixture(), {}, NOW);
    expect(result.metrics.inspections).toBe(10);
    expect(result.metrics.failed_items).toBe(3);
    expect(result.metrics.answered_items).toBe(40);
    expect(result.metrics.failure_rate_pct).toBe(7.5);
    expect(result.table).toHaveLength(2);
    const [q1, q2] = result.table;
    expect(q1).toMatchObject({ group: "Fire exit clear?", failed: 2, share_pct: 66.7, cumulative_share_pct: 66.7, answered: 10, failure_rate_pct: 20 });
    expect(q1!.example_inspections.map((e) => e.id)).toEqual(["audit_2", "audit_1"]);
    expect(q1!.example_inspections[0]!.link).toBe("https://app.safetyculture.com/inspection/audit_2");
    expect(q2).toMatchObject({ group: "Guards fitted?", failed: 1, share_pct: 33.3, cumulative_share_pct: 100, answered: 10, failure_rate_pct: 10 });
    expect(summary).toContain("3 failed items out of 40 answered (7.5%)");
    expect(result.caveats.some((c) => c.includes("partially synced"))).toBe(false);
  });

  it("groups by site with per-site denominators", () => {
    const { result } = analyzeFailedItems(fixture(), { group_by: "site" }, NOW);
    expect(result.table.map((r) => [r.group, r.failed, r.answered, r.failure_rate_pct])).toEqual([
      ["Demo Depot", 2, 24, 8.3],
      ["Demo Yard", 1, 16, 6.3],
    ]);
  });

  it("groups by inspector", () => {
    const { result } = analyzeFailedItems(fixture(), { group_by: "inspector" }, NOW);
    // insp-1 and insp-7 are odd (Alex), insp-2 is even (Blair); each inspector has 5 inspections x 4 answers
    expect(result.table.map((r) => [r.group, r.failed, r.answered])).toEqual([
      ["Alex Demo", 2, 20],
      ["Blair Demo", 1, 20],
    ]);
  });

  it("matches label alternatives case-insensitively; denominator is every answer of the matched question", () => {
    const { result } = analyzeFailedItems(fixture(), { query: "EXIT|nothing-matches" }, NOW);
    expect(result.metrics.failed_items).toBe(2);
    expect(result.metrics.answered_items).toBe(10);
    expect(result.table[0]).toMatchObject({ failed: 2, answered: 10, failure_rate_pct: 20 });
  });

  it("matches on the response text too", () => {
    const { result } = analyzeFailedItems(fixture(), { query: "missing" }, NOW);
    expect(result.table).toHaveLength(1);
    expect(result.table[0]).toMatchObject({ group: "Guards fitted?", failed: 1, answered: 10 });
  });

  it("filters by site and by period", () => {
    expect(analyzeFailedItems(fixture(), { site_ids: ["site-2"] }, NOW).result.metrics).toMatchObject({ inspections: 4, failed_items: 1, answered_items: 16 });
    // 2026-09-11..2026-09-12 holds insp-1 (completed 09-11) and insp-2 (09-12)
    expect(analyzeFailedItems(fixture(), { period: "2026-09-11..2026-09-12" }, NOW).result.metrics).toMatchObject({ inspections: 2, failed_items: 2, answered_items: 8 });
  });

  it("keeps at most 3 example inspections and respects top", () => {
    const c = fixture();
    const items = c.rows("inspection_items").map((i) => (i.label === "Spill kit stocked?" ? { ...i, is_failed_response: true, response: "No" } : i));
    c.seed("inspection_items", items);
    const { result } = analyzeFailedItems(c, { top: 1 }, NOW);
    expect(result.table).toHaveLength(1);
    expect(result.table[0]).toMatchObject({ group: "Spill kit stocked?", failed: 10, share_pct: 76.9 });
    expect(result.table[0]!.example_inspections).toHaveLength(3);
    expect(result.metrics.groups_with_failures).toBe(3);
    expect(result.caveats.some((c) => c.includes("top 1 of 3"))).toBe(true);
  });

  it("flags a truncated feed in caveats", () => {
    const c = fixture();
    c.seed("inspection_items", c.rows("inspection_items"), { complete: false });
    const { result } = analyzeFailedItems(c, {}, NOW);
    expect(result.caveats.some((x) => x.includes('"inspection_items" was only partially synced'))).toBe(true);
  });

  it("returns no rows, not invented numbers, when nothing is cached", () => {
    const c = new FakeCache().seed("inspections", []).seed("inspection_items", []);
    const { result } = analyzeFailedItems(c, {}, NOW);
    expect(result.table).toEqual([]);
    expect(result.metrics.failure_rate_pct).toBeNull();
    expect(result.caveats.some((x) => x.includes('"inspections" is empty'))).toBe(true);
  });

  it("isAnswered excludes structural, free-text, empty and inactive items", () => {
    expect(isAnswered({ type: "question", response: "Yes" })).toBe(true);
    expect(isAnswered({ type: "list", response: "Option" })).toBe(true);
    expect(isAnswered({ type: "text", response: "abc" })).toBe(false);
    expect(isAnswered({ type: "question", response: " " })).toBe(false);
    expect(isAnswered({ type: "question", response: "No", inactive: true })).toBe(false);
  });
});
