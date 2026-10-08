import { describe, expect, it } from "vitest";
import { analyzeScheduleCompliance, outcomeOf } from "../../src/analytics/schedule-compliance.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");

const occ = (schedule: string, occurrence: string, status: string, due: string, extra: Record<string, unknown> = {}) => ({
  id: `${schedule}_${occurrence}_${String(extra.assignee_id ?? "user_a")}`,
  schedule_id: schedule,
  occurrence_id: occurrence,
  template_id: schedule === "sch-1" ? "template_t1" : "template_t2",
  due_time: due,
  occurrence_status: status,
  assignee_id: "user_a",
  completion_rule: "any",
  ...extra,
});

function fixture() {
  const rows = [
    occ("sch-1", "o1", "COMPLETED", "2026-09-10T17:00:00Z"),
    occ("sch-1", "o2", "COMPLETED", "2026-09-11T17:00:00Z"),
    occ("sch-1", "o3", "COMPLETED", "2026-09-12T17:00:00Z"),
    occ("sch-1", "o4", "LATE", "2026-09-13T17:00:00Z"),
    occ("sch-1", "o5", "MISSED", "2026-09-14T17:00:00Z"),
    occ("sch-1", "o6", "WONT_DO", "2026-09-15T17:00:00Z"),
    occ("sch-1", "o7", "TODO", "2026-10-08T17:00:00Z"), // due later today: genuinely pending
    occ("sch-1", "o8", "OVERDUE", "2026-10-07T17:00:00Z"), // past due but still open in the cache: stale
    occ("sch-1", "o9", "COMPLETED", "2026-08-01T17:00:00Z"), // outside the period
    // "any": one assignee completing is enough -> on time; site from the linked inspection
    occ("sch-2", "p1", "COMPLETED", "2026-09-20T17:00:00Z", { audit_id: "audit_x" }),
    occ("sch-2", "p1", "MISSED", "2026-09-20T17:00:00Z", { assignee_id: "user_b" }),
    // "all": every assignee must complete -> missed; site from assignee_from location
    occ("sch-2", "p2", "COMPLETED", "2026-09-27T17:00:00Z", { completion_rule: "all", assignee_from: "location_site-2" }),
    occ("sch-2", "p2", "MISSED", "2026-09-27T17:00:00Z", { completion_rule: "all", assignee_from: "location_site-2", assignee_id: "user_b" }),
    // multi-site schedule, nothing to pin the site
    occ("sch-2", "p3", "MISSED", "2026-10-04T17:00:00Z"),
  ];
  return new FakeCache()
    .seed("schedule_occurrences", rows)
    .seed("schedules", [
      { id: "sch-1", title: "Daily walk", site_ids: ["site-1"], template_id: "template_t1" },
      { id: "sch-2", title: "Weekly forklift", site_ids: '["site-1","site-2"]', template_id: "template_t2" },
    ])
    .seed("schedule_assignees", [
      { id: "sa1", schedule_id: "sch-1", assignee_id: "user_a", name: "Alex Demo" },
      { id: "sa2", schedule_id: "sch-2", assignee_id: "user_b", name: "Blair Demo" },
    ])
    .seed("inspections", [{ id: "audit_x", site_id: "site-2" }])
    .seed("sites", [
      { id: "site-1", name: "Demo Depot" },
      { id: "site-2", name: "Demo Yard" },
    ])
    .seed("templates", [])
    .seed("users", []);
}

describe("analyzeScheduleCompliance", () => {
  it("counts each occurrence once and computes compliance = on time / resolved", () => {
    const { result, summary } = analyzeScheduleCompliance(fixture(), {}, NOW);
    expect(result.metrics).toMatchObject({
      due: 11,
      on_time: 4,
      late: 1,
      missed: 3,
      wont_do: 1,
      pending: 2,
      resolved: 8,
      compliance_pct: 50,
      late_pct: 12.5,
      missed_pct: 37.5,
    });
    expect(summary).toContain("compliance 50% of 8 resolved");
    expect(result.caveats.some((c) => c.startsWith("1 occurrences are past their due time"))).toBe(true);
    expect(result.caveats.some((c) => c.includes('1 occurrences were marked "won\'t do"'))).toBe(true);
  });

  it("groups by schedule, worst first", () => {
    const { result } = analyzeScheduleCompliance(fixture(), {}, NOW);
    expect(result.table.map((r) => [r.group, r.on_time, r.resolved, r.compliance_pct])).toEqual([
      ["Weekly forklift", 1, 3, 33.3],
      ["Daily walk", 3, 5, 60],
    ]);
    expect(result.worst).toHaveLength(2);
  });

  it("groups by site (inspection site, then assignee_from location, then single schedule site)", () => {
    const { result } = analyzeScheduleCompliance(fixture(), { group_by: "site" }, NOW);
    expect(result.table.map((r) => [r.group, r.due, r.on_time, r.resolved, r.compliance_pct])).toEqual([
      ["(multiple sites)", 1, 0, 1, 0],
      ["Demo Yard", 2, 1, 2, 50],
      ["Demo Depot", 8, 3, 5, 60],
    ]);
  });

  it("groups by assignee using each assignee row's own status", () => {
    const { result } = analyzeScheduleCompliance(fixture(), { group_by: "assignee" }, NOW);
    expect(result.table.map((r) => [r.group, r.on_time, r.late, r.missed, r.compliance_pct])).toEqual([
      ["Blair Demo", 0, 0, 2, 0],
      ["Alex Demo", 5, 1, 2, 62.5],
    ]);
  });

  it("site filter leaves out occurrences that cannot be tied to one site, with a caveat", () => {
    const { result } = analyzeScheduleCompliance(fixture(), { site_ids: ["site-2"] }, NOW);
    expect(result.metrics).toMatchObject({ due: 2, on_time: 1, missed: 1, compliance_pct: 50 });
    expect(result.caveats.some((c) => c.startsWith("1 occurrences could not be tied"))).toBe(true);
  });

  it("template filter", () => {
    expect(analyzeScheduleCompliance(fixture(), { template_ids: ["template_t1"] }, NOW).result.metrics).toMatchObject({ due: 8, compliance_pct: 60 });
  });

  it("synced, empty occurrences feed: nothing was scheduled, no rate (never 0% or 100%)", () => {
    const c = new FakeCache().seed("schedule_occurrences", []).seed("schedules", []);
    const { result, summary } = analyzeScheduleCompliance(c, {}, NOW);
    expect(summary).toMatch(/^Nothing was scheduled/);
    expect(result.metrics.compliance_pct).toBeNull();
    expect(result.metrics.due).toBeNull();
    expect(result.table).toEqual([]);
  });

  it("maps documented statuses", () => {
    expect(["TODO", "IN_PROGRESS", "COMPLETED", "LATE", "OVERDUE", "MISSED", "WONT_DO", "?"].map(outcomeOf)).toEqual([
      "pending",
      "pending",
      "on_time",
      "late",
      "pending",
      "missed",
      "wont_do",
      "unknown",
    ]);
  });
});
