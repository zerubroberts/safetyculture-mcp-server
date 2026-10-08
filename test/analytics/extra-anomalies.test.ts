import { describe, expect, it } from "vitest";
import { computeAnomalies } from "../../src/analytics/anomalies.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, insp, item } from "../reports/fixtures.js";

const PERIOD = parsePeriod("last 30 days", NOW);
const at = (day: number, hh = 9, mm = 0) => `2026-09-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`;

function cache() {
  const ins: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  // too_fast: template T, 10 timed inspections (one 100s, nine 600s) + one untimed
  ins.push(insp("audit_t0", { tpl: "template_t", owner: "user_f", duration: 100, completed: at(10) }));
  for (let k = 1; k < 10; k++) ins.push(insp(`audit_t${k}`, { tpl: "template_t", owner: "user_f", duration: 600, completed: at(10 + k) }));
  ins.push(insp("audit_t_untimed", { tpl: "template_t", owner: "user_f", completed: at(25) }));
  // template U has only 9 timed inspections: never judged too fast
  for (let k = 0; k < 9; k++) ins.push(insp(`audit_u${k}`, { tpl: "template_u", owner: "user_f", duration: k ? 600 : 1, completed: at(11 + k) }));

  // perfect_streak on P (org fail rate 2/20 = 10%): X has 10 x 100% then 90%, then 9 x 100%
  for (let k = 0; k < 10; k++) ins.push(insp(`audit_p${k}`, { tpl: "template_p", owner: "user_x", score: 100, completed: at(10, k) }));
  ins.push(insp("audit_p_break", { tpl: "template_p", owner: "user_x", score: 90, completed: at(11) }));
  for (let k = 0; k < 9; k++) ins.push(insp(`audit_p2_${k}`, { tpl: "template_p", owner: "user_x", score: 100, completed: at(12, k) }));
  for (let k = 0; k < 2; k++) {
    ins.push(insp(`audit_py${k}`, { tpl: "template_p", owner: "user_y", completed: at(13 + k) }));
    for (let q = 0; q < 10; q++) its.push(item(`audit_py${k}`, `Q${q}`, { tpl: "template_p", response: q ? "Yes" : "No", failed: q === 0 }));
  }
  // same streak on Q but Q never fails: not flagged
  for (let k = 0; k < 10; k++) ins.push(insp(`audit_q${k}`, { tpl: "template_q", owner: "user_x", score: 100, completed: at(14, k) }));
  its.push(item("audit_q0", "Q0", { tpl: "template_q", response: "Yes" }));

  // duplicate_burst on D by Z: 10:00, 10:02, 10:05 (burst of 3), 10:20; 11:00, 11:03, 11:06 (no burst)
  for (const [h, m] of [[10, 0], [10, 2], [10, 5], [10, 20], [11, 0], [11, 3], [11, 6]] as const)
    ins.push(insp(`audit_d${h}${m}`, { tpl: "template_d", owner: "user_z", completed: at(16, h, m) }));

  // score_outlier on S: 80..96 step 2 and one 20 -> median 87, MAD 5, z(20) = -9.04
  [80, 82, 84, 86, 88, 90, 92, 94, 96, 20].forEach((s, k) => ins.push(insp(`audit_s${k}`, { tpl: "template_s", owner: `user_s${k}`, score: s, completed: at(17, 9, k) })));
  return new FakeCache().seed("inspections", ins).seed("inspection_items", its);
}

describe("computeAnomalies", () => {
  const run = (kind: Parameters<typeof computeAnomalies>[1]["kinds"][number]) => computeAnomalies(cache(), { kinds: [kind], period: PERIOD }, NOW).result;

  it("too_fast: under 25% of the template median, templates with 10+ timed inspections only", () => {
    const r = run("too_fast");
    expect(r.table.map((x) => x.inspection_id)).toEqual(["audit_t0"]);
    expect(r.table[0]!.evidence).toMatchObject({ duration_seconds: 100, template_median_seconds: 600, template_timed_inspections: 10 });
    expect(r.table[0]!.link).toBe("https://app.safetyculture.com/inspection/audit_t0");
  });

  it("perfect_streak: 10 consecutive 100% on a template that fails >= 5% org-wide", () => {
    const r = run("perfect_streak");
    expect(r.table).toHaveLength(1);
    expect(r.table[0]).toMatchObject({ inspection_id: "audit_p0", inspector_id: "user_x" });
    expect(r.table[0]!.evidence).toMatchObject({ streak_length: 10, template_fail_rate_pct: 10 });
    expect(r.table[0]!.related_ids).toHaveLength(10);
  });

  it("duplicate_burst: 3+ within 5 minutes of the first", () => {
    const r = run("duplicate_burst");
    expect(r.table).toHaveLength(1);
    expect(r.table[0]!.related_ids).toEqual(["audit_d100", "audit_d102", "audit_d105"]);
    expect(r.table[0]!.evidence).toMatchObject({ inspections_in_burst: 3, span_minutes: 5 });
  });

  it("score_outlier: robust z beyond 3.5 within template", () => {
    const r = run("score_outlier");
    expect(r.table.map((x) => x.inspection_id)).toEqual(["audit_s9"]);
    expect(r.table[0]!.evidence).toMatchObject({ score_pct: 20, template_median_pct: 87, template_mad: 5, robust_z: -9.04 });
  });

  it("all kinds together, with a neutral summary", () => {
    const { result, summary } = computeAnomalies(cache(), { kinds: ["too_fast", "perfect_streak", "duplicate_burst", "score_outlier"], period: PERIOD }, NOW);
    expect(result.metrics).toMatchObject({ flagged: 4, too_fast: 1, perfect_streak: 1, duplicate_burst: 1, score_outlier: 1 });
    expect(summary).toContain("not findings about anyone");
    expect(summary).not.toMatch(/cheat|fraud|fake|suspicious/i);
  });

  it("scope limits what is flagged, not the baseline", () => {
    const r = computeAnomalies(cache(), { kinds: ["too_fast"], period: PERIOD, template_ids: ["template_s"] }, NOW).result;
    expect(r.table).toHaveLength(0);
  });

  it("caps flags at limit, strongest of each kind first and kinds interleaved, with counts over every flag", () => {
    const ins: Record<string, unknown>[] = [];
    // 60 duplicate bursts (3 inspections each) by different inspectors, plus the score outlier set.
    for (let b = 0; b < 60; b++) for (let k = 0; k < 3; k++) ins.push(insp(`audit_b${b}_${k}`, { tpl: "template_d", owner: `user_b${b}`, completed: at(10 + (b % 15), 9, k) }));
    // One larger burst (4) that must rank first among bursts.
    for (let k = 0; k < 4; k++) ins.push(insp(`audit_big_${k}`, { tpl: "template_d", owner: "user_big", completed: at(26, 9, k) }));
    [80, 82, 84, 86, 88, 90, 92, 94, 96, 20].forEach((s, k) => ins.push(insp(`audit_s${k}`, { tpl: "template_s", owner: `user_s${k}`, score: s, completed: at(17, 9, k) })));
    const big = new FakeCache().seed("inspections", ins).seed("inspection_items", []);
    const args = { kinds: ["duplicate_burst", "score_outlier"] as Parameters<typeof computeAnomalies>[1]["kinds"], period: PERIOD };
    const { result, summary } = computeAnomalies(big, args, NOW);
    expect(result.table).toHaveLength(50);
    expect(result).toMatchObject({ total: 62, truncated: true });
    expect(result.metrics).toMatchObject({ flagged: 62, duplicate_burst: 61, score_outlier: 1 });
    expect(result.table.slice(0, 2).map((r) => [r.kind, r.inspection_id])).toEqual([
      ["duplicate_burst", "audit_big_0"],
      ["score_outlier", "audit_s9"],
    ]);
    expect(result.caveats.some((c) => c.includes("Showing 50 of 62 flags"))).toBe(true);
    expect(summary).toContain("the strongest 50 are listed");
    // Deterministic: the same call returns the same rows in the same order.
    expect(computeAnomalies(big, args, NOW).result.table.map((r) => r.inspection_id)).toEqual(result.table.map((r) => r.inspection_id));
    expect(computeAnomalies(big, { ...args, limit: 500 }, NOW).result).toMatchObject({ total: 62, truncated: false });
  });
});
