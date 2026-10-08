import { describe, expect, it } from "vitest";
import { analyzeActionBacklog, bucketOf, normPriority, normStatus, parseLabels } from "../../src/analytics/backlog.js";
import { ACTION_STATUS } from "../../src/toolsets/actions.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function fixture() {
  const actions = [
    { id: "a1", title: "Tidy store", status: "To Do", priority: "High", site_id: "site-1", created_at: ago(3 * DAY), due_date: ago(-2 * DAY), action_label: '{"label_id":"l1"|"label_name":"Housekeeping"}' },
    // age 7 days 23 hours -> still the 0-7 bucket; due exactly now -> not overdue
    { id: "a2", title: "Check lights", status: "To Do", priority: "Low", site_id: "site-1", created_at: ago(8 * DAY - 3_600_000), due_date: NOW.toISOString() },
    // age exactly 8 days -> 8-30; due 1 ms ago -> overdue by 0 whole days (0-7 bucket)
    { id: "a3", title: "Fix guard", status: "In Progress", priority: "Medium", site_id: "site-1", created_at: ago(8 * DAY), due_date: ago(1) },
    { id: "a4", title: "Rewire panel", status: "To Do", priority: "High", site_id: "site-2", created_at: ago(31 * DAY), due_date: ago(8 * DAY), action_label: '{"label_id":"l1"|"label_name":"Housekeeping"}|{"label_id":"l2"|"label_name":"Electrical"}' },
    { id: "a5", title: "Replace mat", status: "To Do", priority: "", site_id: "site-2", created_at: ago(91 * DAY) },
    { id: "a6", title: "Paint lines", status: ACTION_STATUS.to_do, priority: "Low", created_at: ago(90 * DAY), due_date: ago(40 * DAY) },
    { id: "c1", status: "Complete", priority: "Low", site_id: "site-1", created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-03T00:00:00Z" },
    { id: "c2", status: "Complete", priority: "Low", site_id: "site-1", created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-05T00:00:00Z" },
    { id: "c3", status: "Complete", priority: "Low", site_id: "site-2", created_at: "2026-09-01T00:00:00Z", completed_at: "2026-09-11T00:00:00Z" },
    { id: "c4", status: "Can't do", priority: "Low", site_id: "site-2", created_at: "2026-09-15T00:00:00Z", completed_at: "2026-09-20T00:00:00Z" },
    { id: "c5", status: "Complete", priority: "Low", site_id: "site-2", created_at: "2026-05-20T00:00:00Z", completed_at: "2026-06-01T00:00:00Z" },
  ];
  return new FakeCache()
    .seed("actions", actions)
    .seed("action_assignees", [
      { id: "x1", action_id: "a1", assignee_id: "user_a", name: "Alex Demo", type: "USER" },
      { id: "x2", action_id: "a1", assignee_id: "group_ops", name: "Ops Team", type: "GROUP" },
      { id: "x3", action_id: "a3", assignee_id: "user_a", name: "Alex Demo", type: "USER" },
    ])
    .seed("sites", [
      { id: "site-1", name: "Demo Depot" },
      { id: "site-2", name: "Demo Yard" },
    ]);
}

describe("analyzeActionBacklog", () => {
  it("buckets open actions by age and overdue days with exact boundaries", () => {
    const { result } = analyzeActionBacklog(fixture(), {}, NOW);
    expect(result.metrics).toMatchObject({
      open: 6,
      overdue: 3,
      open_no_due_date: 1,
      age_0_7: 2,
      age_8_30: 1,
      age_31_90: 2,
      age_90_plus: 1,
      overdue_0_7: 1,
      overdue_8_30: 1,
      overdue_31_90: 1,
      overdue_90_plus: 0,
    });
  });

  it("computes resolution median and p90 for actions completed in the period (Can't do excluded)", () => {
    const { result } = analyzeActionBacklog(fixture(), {}, NOW);
    // days: 2, 4, 10 -> median 4, p90 = 4 + 0.8 * 6 = 8.8
    expect(result.metrics.completed_in_period).toBe(3);
    expect(result.metrics.median_resolution_days).toBe(4);
    expect(result.metrics.p90_resolution_days).toBe(8.8);
  });

  it("counts opened vs closed per Monday week inside the period", () => {
    const { result } = analyzeActionBacklog(fixture(), {}, NOW);
    // last 90 days = 2026-07-11 .. 2026-10-08; a5 (created 07-09), a6 (07-10 12:00) and c5 fall outside
    expect(result.metrics.opened_in_period).toBe(8);
    expect(result.metrics.closed_in_period).toBe(4);
    expect(result.weekly[0]!.week_start).toBe("2026-07-06");
    const sep1 = result.weekly.find((w) => w.week_start === "2026-08-31")!;
    expect(sep1).toEqual({ week_start: "2026-08-31", opened: 3, closed: 2 });
    expect(result.weekly.find((w) => w.week_start === "2026-09-14")).toEqual({ week_start: "2026-09-14", opened: 1, closed: 1 });
  });

  it("groups by site, sorted by overdue then open", () => {
    const { result } = analyzeActionBacklog(fixture(), {}, NOW);
    expect(result.table.map((r) => [r.group, r.open, r.overdue, r.no_due_date, r.oldest_age_days])).toEqual([
      ["Demo Depot", 3, 1, 0, 8],
      ["Demo Yard", 2, 1, 1, 91],
      ["(no site)", 1, 1, 0, 90],
    ]);
  });

  it("groups by assignee using action_assignees (one action can be in several groups)", () => {
    const { result } = analyzeActionBacklog(fixture(), { group_by: "assignee" }, NOW);
    expect(result.table.map((r) => [r.group, r.open, r.overdue])).toEqual([
      ["(unassigned)", 4, 2],
      ["Alex Demo", 2, 1],
      ["Ops Team", 1, 0],
    ]);
    expect(result.caveats.some((c) => c.includes("counted in each"))).toBe(true);
  });

  it("groups by label and by priority", () => {
    expect(analyzeActionBacklog(fixture(), { group_by: "label" }, NOW).result.table.map((r) => [r.group, r.open])).toEqual([
      ["(no label)", 4], // a2, a3, a5, a6: 2 overdue
      ["Housekeeping", 2], // a1, a4: 1 overdue
      ["Electrical", 1], // a4: 1 overdue
    ]);
    expect(analyzeActionBacklog(fixture(), { group_by: "priority" }, NOW).result.table.map((r) => [r.group, r.open, r.overdue])).toEqual([
      ["high", 2, 1],
      ["low", 2, 1],
      ["medium", 1, 1],
      ["none", 1, 0],
    ]);
  });

  it("applies priority, site and overdue_only filters", () => {
    expect(analyzeActionBacklog(fixture(), { priority: ["high"] }, NOW).result.metrics).toMatchObject({ open: 2, overdue: 1 });
    expect(analyzeActionBacklog(fixture(), { site_ids: ["site-2"] }, NOW).result.metrics).toMatchObject({ open: 2, overdue: 1, completed_in_period: 1 });
    expect(analyzeActionBacklog(fixture(), { overdue_only: true }, NOW).result.metrics).toMatchObject({ open: 3, overdue: 3 });
  });

  it("lists the oldest open actions first with links", () => {
    const { result } = analyzeActionBacklog(fixture(), {}, NOW);
    expect(result.oldest_open.map((r) => r.id)).toEqual(["a5", "a6", "a4", "a3", "a2", "a1"]);
    expect(result.oldest_open[1]).toMatchObject({ age_days: 90, overdue_days: 40, link: "https://app.safetyculture.com/actions/a6" });
    expect(result.oldest_open[4]).toMatchObject({ id: "a2", overdue_days: null });
  });

  it("treats an unrecognised status as open only without a completion date, and says so", () => {
    const c = fixture();
    c.seed("actions", [
      { id: "u1", status: "Awaiting review", created_at: ago(DAY) },
      { id: "u2", status: "Awaiting review", created_at: ago(DAY), completed_at: ago(1000) },
    ]);
    const { result } = analyzeActionBacklog(c, {}, NOW);
    expect(result.metrics.open).toBe(1);
    expect(result.caveats.some((x) => x.includes("2 actions have an unrecognised status"))).toBe(true);
  });

  it("normalisers", () => {
    expect(bucketOf(7)).toBe("0-7");
    expect(bucketOf(8)).toBe("8-30");
    expect(bucketOf(30)).toBe("8-30");
    expect(bucketOf(90)).toBe("31-90");
    expect(bucketOf(91)).toBe("90+");
    expect(normStatus("Can't do")).toBe("cant_do");
    expect(normStatus("IN_PROGRESS")).toBe("in_progress");
    expect(normStatus(ACTION_STATUS.complete)).toBe("complete");
    expect(normPriority("02eb40c1-4f46-40c5-be16-d32941c96ec9")).toBe("high");
    expect(normPriority(undefined)).toBe("none");
    expect(parseLabels('{"label_id":"x"|"label_name":"label three"}')).toEqual(["label three"]);
    expect(parseLabels("A|B")).toEqual(["A", "B"]);
  });
});
