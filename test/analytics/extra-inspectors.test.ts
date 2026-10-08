import { describe, expect, it } from "vitest";
import { computeInspectorActivity } from "../../src/analytics/inspectors.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, insp, item } from "../reports/fixtures.js";

/**
 * Template TA (10 timed inspections, median 600s, "very fast" < 150s):
 *   A: 2 inspections (600s, 100s), 10 answered each, 2 failed each   -> 4/20 = 20%
 *   B: 2 inspections (600s, 600s), 10 answered each, 0 failed        -> 0/20
 *   C: 6 inspections (600s), no items
 * Template TB: B has 1 inspection (no duration), 10 answered, 5 failed.
 * Org rates: TA 4/40 = 10%, TB 5/10 = 50%.
 */
function cache() {
  const ins: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  const add = (id: string, owner: string, name: string, tpl: string, duration: number, failed: number) => {
    ins.push(insp(id, { tpl, owner, ownerName: name, duration, completed: "2026-09-20T10:00:00.000Z" }));
    for (let q = 0; q < (tpl === "none" ? 0 : 10); q++) its.push(item(id, `Q${q}`, { response: q < failed ? "No" : "Yes", failed: q < failed }));
  };
  add("audit_a1", "user_a", "Alex Demo", "template_ta", 600, 2);
  add("audit_a2", "user_a", "Alex Demo", "template_ta", 100, 2);
  add("audit_b1", "user_b", "Bo Sample", "template_ta", 600, 0);
  add("audit_b2", "user_b", "Bo Sample", "template_ta", 600, 0);
  add("audit_b3", "user_b", "Bo Sample", "template_tb", 0, 5);
  for (let k = 0; k < 6; k++) ins.push(insp(`audit_c${k}`, { tpl: "template_ta", owner: "user_c", ownerName: "Cam Test", duration: 600, completed: "2026-09-21T10:00:00.000Z" }));
  return new FakeCache().seed("inspections", ins).seed("inspection_items", its).seed("users", []);
}

describe("computeInspectorActivity", () => {
  const { result, summary } = computeInspectorActivity(cache(), { period: parsePeriod("last 30 days", NOW) }, NOW);
  const row = (id: string) => result.table.find((r) => r.inspector_id === id)!;

  it("rates against the organisation on the same template mix", () => {
    expect(row("user_a")).toMatchObject({ inspections: 2, answered_items: 20, failed_items: 4, failed_item_rate: 20, expected_rate_same_templates: 10, difference_pp: 10 });
    // B: 5/30 = 16.7%; expected (20 x 10% + 10 x 50%) / 30 = 23.3%
    expect(row("user_b")).toMatchObject({ inspections: 3, templates: 2, answered_items: 30, failed_items: 5, failed_item_rate: 16.7, expected_rate_same_templates: 23.3, difference_pp: -6.6 });
    expect(row("user_c")).toMatchObject({ inspections: 6, answered_items: 0, failed_item_rate: null, expected_rate_same_templates: null });
  });

  it("median duration and very fast share", () => {
    expect(row("user_a")).toMatchObject({ median_duration_seconds: 350, very_fast: 1, very_fast_eligible: 2, very_fast_share: 50 });
    expect(row("user_b")).toMatchObject({ median_duration_seconds: 600, very_fast: 0, very_fast_eligible: 2, very_fast_share: 0 });
    expect(result.metrics.templates_with_duration_baseline).toBe(1);
  });

  it("sorts by volume and says it is not a performance score", () => {
    expect(result.table.map((r) => r.inspector_id)).toEqual(["user_c", "user_b", "user_a"]);
    expect(summary).toContain("not a performance score");
    expect(result.caveats.some((c) => c.includes("not a performance score"))).toBe(true);
    expect(result.caveats).toContain('Feed "users" is empty for this organisation (module unused or no access).');
  });
});
