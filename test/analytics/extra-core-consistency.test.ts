import { describe, expect, it } from "vitest";
import { analyzeFailedItems } from "../../src/analytics/failed-items.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { actionPriority, actionStatus, computeTrend, isOpenAction } from "../../src/analytics/trend.js";
import { computeInspectorActivity } from "../../src/analytics/inspectors.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, item } from "../reports/fixtures.js";

/** Mixed item types: only question/list count as answered (core rule), text and checkbox do not. */
function cache() {
  const ins: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  for (let k = 0; k < 12; k++) {
    const id = `audit_c${k}`;
    ins.push(insp(id, { tpl: "template_t1", owner: k % 2 ? "user_a" : "user_b", completed: `2026-09-${String(10 + k).padStart(2, "0")}T09:00:00.000Z` }));
    its.push(
      item(id, "Q1", { response: k < 3 ? "No" : "Yes", failed: k < 3 }),
      item(id, "L1", { type: "list", response: k < 1 ? "Fail" : "Pass", failed: k < 1 }),
      item(id, "T1", { type: "text", response: "note" }),
      item(id, "C1", { type: "checkbox", response: "true", failed: true }),
    );
  }
  return new FakeCache()
    .seed("inspections", ins)
    .seed("inspection_items", its)
    .seed("users", [])
    .seed("actions", [
      action("x1", { status: "COMPLETE", created: "2026-09-01T00:00:00Z", completed: "2026-09-03T00:00:00Z" }),
      action("x2", { status: "CANNOT_DO", created: "2026-09-01T00:00:00Z", completed: "2026-09-04T00:00:00Z" }),
      action("x3", { status: "IN_PROGRESS", priority: "HIGH", created: "2026-09-02T00:00:00Z" }),
    ]);
}

describe("extended analytics use the core definitions", () => {
  it("failed-item rate matches the core failed-items and pulse (4 failed of 24 answered)", () => {
    const c = cache();
    const core = analyzeFailedItems(c, { period: "2026-09" }, NOW).result.metrics;
    expect(core).toMatchObject({ failed_items: 4, answered_items: 24 });
    const trend = computeTrend(c, { metric: "failed_item_rate", grain: "month", period: parsePeriod("2026-09", NOW) }, NOW).result.table[0]!;
    expect(trend).toMatchObject({ value: core.failure_rate_pct, n: 24 });
    const pulse = safetyPulse(c, { period: "2026-09" }, NOW).result.metrics;
    expect(pulse).toMatchObject({ failed_items: 4, answered_items: 24 });
    const insp = computeInspectorActivity(c, { period: parsePeriod("2026-09", NOW) }, NOW).result.table;
    expect(insp.reduce((s, r) => s + (r.failed_items ?? NaN), 0)).toBe(4);
    expect(insp.reduce((s, r) => s + (r.answered_items ?? NaN), 0)).toBe(24);
  });

  it("live action status and priority values", () => {
    expect(actionStatus("CANNOT_DO")).toBe("cant_do");
    expect(actionStatus("IN_PROGRESS")).toBe("in_progress");
    expect(actionPriority("HIGH")).toBe("high");
    expect(isOpenAction(action("y", { status: "CANNOT_DO" }))).toBe(false);
    expect(isOpenAction(action("y", { status: "TODO" }))).toBe(true);
  });

  it("actions completed matches the core backlog (cannot-do is closed, not completed)", () => {
    const c = cache();
    const sep = parsePeriod("2026-09", NOW);
    const t = computeTrend(c, { metric: "actions_completed", grain: "month", period: sep }, NOW).result.table[0]!;
    const core = analyzeActionBacklog(c, { period: "2026-09" }, NOW).result.metrics;
    expect(t.value).toBe(1);
    expect(core.completed_in_period).toBe(1);
    expect(core.open).toBe(1);
  });
});
