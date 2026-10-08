import { describe, expect, it } from "vitest";
import type { FeedName } from "../../src/cache/contract.js";
import { analyzeSiteLeague } from "../../src/analytics/league.js";
import { computeInspectorActivity } from "../../src/analytics/inspectors.js";
import { ANOMALY_KINDS, computeAnomalies } from "../../src/analytics/anomalies.js";
import { computeStalls } from "../../src/analytics/stalls.js";
import { computeTemplateQuality } from "../../src/analytics/template-quality.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { analyzeFailedItems } from "../../src/analytics/failed-items.js";
import { parsePeriod } from "../../src/core/time.js";
import { NOW, action, insp, item, site, timeline } from "../reports/fixtures.js";
import { UNUSABLE, stateCache } from "./feed-states.js";

/**
 * Fail closed, second pass: league, inspectors, anomalies, stalls, template quality, backlog's assignee grouping,
 * and the inspections feed under pulse and failed items. An unreadable feed gives null figures plus the reason,
 * never 0; a feed that synced successfully and is empty still gives true zeros with the empty-feed caveat.
 */

const PERIOD = parsePeriod("last 30 days", NOW);
const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** 30 completed inspections (15 per site, 4 answered items each, 1 failed), 12 actions (10 open and overdue), timeline and assignees. */
function data(): Partial<Record<FeedName, Record<string, unknown>[]>> {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let k = 0; k < 30; k++) {
    const id = `audit_f${k}`;
    inspections.push(insp(id, { tpl: "template_t1", site: k < 15 ? "site-1" : "site-2", owner: k % 2 ? "user_a" : "user_b", completed: DAYS(1 + (k % 20)), score: 90, duration: 600 }));
    items.push(item(id, "Guard fitted", { response: "No", failed: true }), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
  }
  const actions: Record<string, unknown>[] = [];
  const timelineRows: Record<string, unknown>[] = [];
  for (let k = 0; k < 12; k++) {
    const id = `0000000${k.toString(16)}-1111-4111-8111-111111111111`;
    const done = k >= 10;
    actions.push(action(id, { status: done ? "COMPLETE" : "TODO", site: k % 2 ? "site-1" : "site-2", created: DAYS(40 + k), due: DAYS(5 + k), completed: done ? DAYS(3) : null }));
    timelineRows.push(timeline(id, "TASK_CREATED", DAYS(40 + k)), timeline(id, "TASK_DUE_AT_UPDATED", DAYS(20 + k), { due_at: DAYS(5 + k) }));
  }
  return {
    inspections,
    inspection_items: items,
    actions,
    action_timeline_items: timelineRows,
    action_assignees: actions.slice(0, 6).map((a) => ({ action_id: a.id, assignee_id: "user_a", name: "Alex Demo", type: "USER" })),
    sites: [site("site-1", "Depot"), site("site-2", "Yard")],
    templates: [{ id: "template_t1", name: "Pre-start" }],
    users: [],
  };
}

const allNull = (metrics: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) expect(metrics[k], k).toBeNull();
};

describe("site league fails closed", () => {
  for (const u of UNUSABLE) {
    it(`inspections feed ${u.name}: no league, null counts, reason in the summary`, () => {
      const { summary, result } = analyzeSiteLeague(stateCache(data(), "inspections", u), {}, NOW);
      allNull(result.metrics, ["ranked_sites", "below_minimum", "metrics_used"]);
      expect(result.table).toEqual([]);
      expect(result.below_minimum).toEqual([]);
      expect(summary).toMatch(/^Site league unavailable: the inspections feed /);
      expect(summary).toMatch(u.reason);
    });

    it(`inspection_items feed ${u.name}: failed-item rate is null and left out of the composite`, () => {
      const { summary, result } = analyzeSiteLeague(stateCache(data(), "inspection_items", u), {}, NOW);
      expect(result.table).toHaveLength(2);
      for (const r of result.table) {
        expect(r.failed_item_rate).toBeNull();
        expect(r.answered_items).toBeNull();
        expect(r.inspections).toBe(15);
      }
      expect(String(result.metrics.metrics_used)).not.toContain("failed_item_rate");
      expect(summary).toContain("Failed-item rate unavailable: the inspection_items feed ");
      expect(summary).toMatch(u.reason);
    });

    it(`actions feed ${u.name}: overdue and resolution are null, not 0`, () => {
      const { summary, result } = analyzeSiteLeague(stateCache(data(), "actions", u), {}, NOW);
      expect(result.table).toHaveLength(2);
      for (const r of result.table) {
        expect(r.overdue_actions).toBeNull();
        expect(r.median_resolution_days).toBeNull();
      }
      expect(String(result.metrics.metrics_used)).not.toMatch(/overdue_actions|median_resolution_days/);
      expect(summary).toContain("Action metrics unavailable: the actions feed ");
    });
  }

  it("asking only for a metric whose feed is unreadable gives no ranking", () => {
    const { summary, result } = analyzeSiteLeague(stateCache(data(), "inspection_items", UNUSABLE[0]), { metrics: ["failed_item_rate"] }, NOW);
    expect(result.table).toEqual([]);
    expect(result.metrics.ranked_sites).toBeNull();
    expect(summary).toMatch(/^Site league unavailable: the inspection_items feed could not be read/);
  });

  it("healthy and empty-but-synced feeds give real figures and true zeros", () => {
    const healthy = analyzeSiteLeague(stateCache(data()), {}, NOW).result;
    expect(healthy.table.map((r) => r.failed_item_rate)).toEqual([25, 25]);
    expect(healthy.table.map((r) => r.overdue_actions).sort()).toEqual([5, 5]);
    const empty = analyzeSiteLeague(stateCache({ ...data(), actions: [] }), {}, NOW).result;
    expect(empty.table.map((r) => r.overdue_actions)).toEqual([0, 0]);
    expect(empty.caveats).toContainEqual(expect.stringMatching(/Feed "actions" is empty/));
  });
});

describe("inspector activity fails closed", () => {
  for (const u of UNUSABLE) {
    it(`inspections feed ${u.name}: every figure null, no rows`, () => {
      const { summary, result } = computeInspectorActivity(stateCache(data(), "inspections", u), { period: PERIOD }, NOW);
      allNull(result.metrics, ["inspectors", "inspections", "templates_with_duration_baseline"]);
      expect(result.table).toEqual([]);
      expect(summary).toMatch(/^Inspector figures unavailable: the inspections feed /);
      expect(summary).toMatch(u.reason);
    });

    it(`inspection_items feed ${u.name}: item counts and rates null per inspector`, () => {
      const { summary, result } = computeInspectorActivity(stateCache(data(), "inspection_items", u), { period: PERIOD }, NOW);
      expect(result.metrics.inspections).toBe(30);
      expect(result.table).toHaveLength(2);
      for (const r of result.table) {
        expect(r.answered_items).toBeNull();
        expect(r.failed_items).toBeNull();
        expect(r.failed_item_rate).toBeNull();
        expect(r.expected_rate_same_templates).toBeNull();
        expect(r.difference_pp).toBeNull();
      }
      expect(summary).toContain("Failed-item figures unavailable: the inspection_items feed ");
    });
  }

  it("an empty-but-synced items feed gives 0 answered items with the empty-feed caveat", () => {
    const { result } = computeInspectorActivity(stateCache({ ...data(), inspection_items: [] }), { period: PERIOD }, NOW);
    for (const r of result.table) expect(r.answered_items).toBe(0);
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "inspection_items" is empty/));
  });
});

describe("inspection anomalies fail closed", () => {
  const kinds = [...ANOMALY_KINDS];
  for (const u of UNUSABLE) {
    it(`inspections feed ${u.name}: no checks run, every count null`, () => {
      const { summary, result } = computeAnomalies(stateCache(data(), "inspections", u), { kinds, period: PERIOD }, NOW);
      allNull(result.metrics, ["inspections_in_scope", "flagged", ...kinds]);
      expect(result.table).toEqual([]);
      expect(summary).toMatch(/^Anomaly checks unavailable: the inspections feed /);
      expect(summary).toMatch(u.reason);
    });

    it(`inspection_items feed ${u.name}: perfect streaks not checked (null), other kinds still counted`, () => {
      const { summary, result } = computeAnomalies(stateCache(data(), "inspection_items", u), { kinds, period: PERIOD }, NOW);
      expect(result.metrics.perfect_streak).toBeNull();
      expect(result.metrics.perfect_streaks).toBeNull();
      expect(result.metrics.too_fast).toBe(0);
      expect(result.metrics.inspections_in_scope).toBe(30);
      expect(summary).toContain("perfect streak not checked");
      expect(summary).toContain("Perfect-streak check unavailable: the inspection_items feed ");
    });
  }

  it("an empty-but-synced inspections feed gives 0 in scope and 0 flagged", () => {
    const { result } = computeAnomalies(stateCache({ ...data(), inspections: [] }), { kinds, period: PERIOD }, NOW);
    expect(result.metrics).toMatchObject({ inspections_in_scope: 0, flagged: 0, too_fast: 0 });
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "inspections" is empty/));
  });
});

describe("action stalls fail closed", () => {
  const keys = ["actions", "open", "median_longest_gap_days", "with_due_date_changes", "with_reassignments", "stalls_most_in"];
  for (const feed of ["actions", "action_timeline_items"] as FeedName[])
    for (const u of UNUSABLE)
      it(`${feed} feed ${u.name}: every figure null, no rows`, () => {
        const { summary, result } = computeStalls(stateCache(data(), feed, u), { limit: 50 }, NOW);
        allNull(result.metrics, keys);
        expect(result.table).toEqual([]);
        expect(result.by_status).toEqual([]);
        expect(summary).toMatch(new RegExp(`^Action stall figures unavailable: the ${feed} feed `));
        expect(summary).toMatch(u.reason);
      });

  it("an empty-but-synced timeline feed still analyses the actions, with 0 due-date changes", () => {
    const { result } = computeStalls(stateCache({ ...data(), action_timeline_items: [] }), { limit: 50 }, NOW);
    expect(result.metrics).toMatchObject({ actions: 12, with_due_date_changes: 0, with_reassignments: 0 });
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "action_timeline_items" is empty/));
  });
});

describe("template quality fails closed", () => {
  const args = { template_id: "template_t1", period: PERIOD };
  for (const u of UNUSABLE) {
    it(`inspections feed ${u.name}: every figure null, no rows`, () => {
      const { summary, result } = computeTemplateQuality(stateCache(data(), "inspections", u), args, NOW);
      allNull(result.metrics, ["inspections", "items", "cut_candidates", "fix", "keep", "median_duration_seconds", "duplicate_labels"]);
      expect(result.table).toEqual([]);
      expect(summary).toMatch(/^Template quality figures unavailable: the inspections feed /);
      expect(summary).toMatch(u.reason);
    });

    it(`inspection_items feed ${u.name}: item figures null, inspection count kept`, () => {
      const { summary, result } = computeTemplateQuality(stateCache(data(), "inspection_items", u), args, NOW);
      expect(result.metrics.inspections).toBe(30);
      allNull(result.metrics, ["items", "cut_candidates", "fix", "keep", "duplicate_labels"]);
      expect(result.table).toEqual([]);
      expect(summary).toContain("Item figures unavailable: the inspection_items feed ");
    });
  }

  it("an empty-but-synced items feed gives 0 items with the empty-feed caveat", () => {
    const { result } = computeTemplateQuality(stateCache({ ...data(), inspection_items: [] }), args, NOW);
    expect(result.metrics).toMatchObject({ inspections: 30, items: 0, cut_candidates: 0 });
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "inspection_items" is empty/));
  });
});

describe("action backlog by assignee fails closed", () => {
  for (const u of UNUSABLE)
    it(`action_assignees feed ${u.name}: grouping unavailable, nobody shown as unassigned`, () => {
      const { summary, result } = analyzeActionBacklog(stateCache(data(), "action_assignees", u), { group_by: "assignee" }, NOW);
      expect(result.table).toEqual([]);
      expect(result.metrics.open).toBe(10);
      expect(summary).toContain("Assignee grouping unavailable: the action_assignees feed ");
      expect(summary).toMatch(u.reason);
      expect(result.caveats).toContainEqual(expect.stringMatching(/^No assignee grouping: /));
    });

  it("an empty-but-synced assignees feed shows every open action as unassigned", () => {
    const { result } = analyzeActionBacklog(stateCache({ ...data(), action_assignees: [] }), { group_by: "assignee" }, NOW);
    expect(result.table).toEqual([expect.objectContaining({ group: "(unassigned)", open: 10 })]);
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "action_assignees" is empty/));
  });
});

describe("pulse and failed items with the inspections feed unreadable", () => {
  for (const u of UNUSABLE) {
    it(`pulse, inspections feed ${u.name}: inspection and failed-item figures null, rows omitted`, () => {
      const { summary, result } = safetyPulse(stateCache(data(), "inspections", u), { period: "last 30 days" }, NOW);
      allNull(result.metrics, ["inspections_completed", "inspections_completed_previous", "average_score", "failed_item_rate", "answered_items", "failed_items", "scored_inspections"]);
      expect(result.table.some((r) => ["inspections_completed", "average_score", "failed_item_rate"].includes(r.metric))).toBe(false);
      expect(summary).toContain("Inspection figures unavailable: the inspections feed ");
      expect(summary).toMatch(u.reason);
      expect(summary).not.toMatch(/inspections completed|average score/);
      expect(result.metrics.open_overdue_actions).toBe(10);
    });

    it(`failed items, inspections feed ${u.name}: every figure null, including the inspection count`, () => {
      const { summary, result } = analyzeFailedItems(stateCache(data(), "inspections", u), { period: "last 30 days" }, NOW);
      allNull(result.metrics, ["inspections", "failed_items", "answered_items", "failure_rate_pct", "groups_with_failures"]);
      expect(result.table).toEqual([]);
      expect(summary).toMatch(/^Inspection and failed-item figures unavailable: the inspections feed /);
    });
  }

  it("an empty-but-synced inspections feed gives 0 inspections in pulse and failed items", () => {
    const c = stateCache({ ...data(), inspections: [] });
    expect(safetyPulse(c, { period: "last 30 days" }, NOW).result.metrics.inspections_completed).toBe(0);
    const f = analyzeFailedItems(c, { period: "last 30 days" }, NOW).result;
    expect(f.metrics).toMatchObject({ inspections: 0, failed_items: 0 });
    expect(f.caveats).toContainEqual(expect.stringMatching(/Feed "inspections" is empty/));
  });
});
