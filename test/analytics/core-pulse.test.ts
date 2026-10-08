import { describe, expect, it } from "vitest";
import { direction, safetyPulse } from "../../src/analytics/pulse.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
// "last 7 days" = 2026-10-02 .. 2026-10-08; previous period = 2026-09-25 .. 2026-10-01

function inspections(prefix: string, n: number, day: string, score: number, failFirst: (i: number, q: number) => boolean) {
  const insp: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const id = `audit_${prefix}${i}`;
    insp.push({ id, archived: false, date_completed: `${day}T10:${String(i).padStart(2, "0")}:00Z`, site_id: "site-1", template_id: "template_t1", score_percentage: score, max_score: 10 });
    for (let q = 1; q <= 4; q++)
      items.push({ id: `${id}-${q}`, audit_id: id, template_id: "template_t1", label: `Q${q}`, type: "question", response: "x", is_failed_response: failFirst(i, q) });
  }
  return { insp, items };
}

function fixture(withSchedules = true) {
  // current: 25 inspections at 80%, 100 answered, 30 failed (Q1 in all 25, Q2 in the first 5)
  const cur = inspections("c", 25, "2026-10-05", 80, (i, q) => q === 1 || (q === 2 && i < 5));
  // previous: 22 inspections at 90%, 88 answered, 4 failed
  const prev = inspections("p", 22, "2026-09-28", 90, (i, q) => q === 1 && i < 4);
  const c = new FakeCache()
    .seed("inspections", [...cur.insp, ...prev.insp])
    .seed("inspection_items", [...cur.items, ...prev.items])
    .seed("issues", [
      { id: "iss1", title: "Gas smell", priority: "High", created_at: "2026-10-06T08:00:00Z", site_id: "site-1" },
      { id: "iss2", title: "Loose rail", priority: "Low", created_at: "2026-10-05T08:00:00Z", site_id: "site-1" },
      { id: "iss3", title: "Blocked exit", priority: "High", created_at: "2026-10-03T08:00:00Z", site_id: "site-2" },
      { id: "iss0", title: "Old issue", priority: "High", created_at: "2026-09-30T08:00:00Z", site_id: "site-1" },
    ])
    .seed("actions", [
      { id: "h1", title: "Repair guard", status: "To Do", priority: "High", site_id: "site-1", created_at: ago(10), due_date: ago(5) },
      { id: "m1", title: "Order signs", status: "In Progress", priority: "Medium", site_id: "site-1", created_at: ago(40), due_date: ago(20) },
      { id: "n1", title: "New one", status: "To Do", priority: "Low", site_id: "site-1", created_at: ago(1), due_date: ago(-3) },
      { id: "d1", status: "Complete", priority: "Low", site_id: "site-1", created_at: ago(3), completed_at: ago(2) },
    ])
    .seed("templates", [
      { id: "template_t1", name: "Demo Walkthrough" },
      { id: "template_t2", name: "Demo Forklift Check" },
    ])
    .seed("sites", [])
    .seed("schedules", []);
  c.seed(
    "schedule_occurrences",
    withSchedules
      ? [
          { id: "o1", schedule_id: "s1", occurrence_id: "o1", template_id: "template_t2", due_time: "2026-10-03T17:00:00Z", occurrence_status: "MISSED" },
          { id: "o2", schedule_id: "s1", occurrence_id: "o2", template_id: "template_t2", due_time: "2026-10-04T17:00:00Z", occurrence_status: "MISSED" },
          { id: "o3", schedule_id: "s2", occurrence_id: "o3", template_id: "template_t1", due_time: "2026-10-04T17:00:00Z", occurrence_status: "MISSED" },
          { id: "o4", schedule_id: "s2", occurrence_id: "o4", template_id: "template_t1", due_time: "2026-10-05T17:00:00Z", occurrence_status: "COMPLETED" },
          { id: "o5", schedule_id: "s2", occurrence_id: "o5", template_id: "template_t1", due_time: "2026-09-28T17:00:00Z", occurrence_status: "MISSED" },
        ]
      : [],
  );
  return c;
}

describe("safetyPulse", () => {
  it("computes each metric for both periods, with directions only above 20 observations", () => {
    const { result } = safetyPulse(fixture(), {}, NOW);
    const m = Object.fromEntries(result.table.map((r) => [r.metric, r]));
    expect(m.inspections_completed).toMatchObject({ current: 25, previous: 22, delta: 3, direction: "up" });
    expect(m.average_score).toMatchObject({ current: 80, previous: 90, delta: -10, direction: "down", n_current: 25, n_previous: 22 });
    expect(m.failed_item_rate).toMatchObject({ current: 30, previous: 4.55, delta: 25.45, direction: "up", n_current: 100, n_previous: 88 });
    expect(m.new_issues).toMatchObject({ current: 3, previous: 1, direction: "too few to compare" });
    expect(m.actions_created).toMatchObject({ current: 2, previous: 1, // n1, d1 vs h1 (created 09-28)
      direction: "too few to compare" });
    expect(m.actions_completed).toMatchObject({ current: 1, previous: 0 });
    expect(m.missed_scheduled_inspections).toMatchObject({ current: 3, previous: 1, n_current: 4, n_previous: 1, direction: "too few to compare" });
    expect(m.open_overdue_actions).toMatchObject({ current: 2, direction: "snapshot" });
    expect(result.metrics.oldest_overdue_action_age_days).toBe(40);
    expect(result.metrics.max_days_overdue).toBe(20);
    expect(result.previous_period.from).toBe("2026-09-25T00:00:00.000Z");
  });

  it("orders attention by the severity rule and caps it at three", () => {
    const { result } = safetyPulse(fixture(), {}, NOW);
    expect(result.attention.map((a) => [a.kind, a.record_id])).toEqual([
      ["overdue_high_priority_action", "h1"],
      ["missed_scheduled_inspections", "template_t2"],
      ["missed_scheduled_inspections", "template_t1"],
    ]);
    expect(result.attention[0]!.link).toBe("https://app.safetyculture.com/actions/h1");
    expect(result.attention[1]!.detail).toContain('2 scheduled inspections missed on template "Demo Forklift Check"');
  });

  it("without schedule data: falls through to the failed-rate jump, then new high-priority issues", () => {
    const { result } = safetyPulse(fixture(false), {}, NOW);
    expect(result.attention.map((a) => [a.kind, a.record_id])).toEqual([
      ["overdue_high_priority_action", "h1"],
      ["failed_rate_jump", "template_t1"],
      ["new_high_priority_issue", "iss1"],
    ]);
    expect(result.attention[1]!.detail).toContain("rose 25.5 points");
    expect(result.attention[2]!.link).toBe("https://app.safetyculture.com/issues/iss1");
    expect(result.table.some((r) => r.metric === "missed_scheduled_inspections")).toBe(false);
    expect(result.caveats.some((c) => c.includes("missed scheduled inspections are not reported"))).toBe(true);
  });

  it("site filter", () => {
    const { result } = safetyPulse(fixture(), { site_ids: ["site-2"] }, NOW);
    expect(result.metrics.inspections_completed).toBe(0);
    expect(result.metrics.new_issues).toBe(1);
    expect(result.metrics.open_overdue_actions).toBe(0);
  });

  it("states a caveat when a feed is truncated", () => {
    const c = fixture();
    c.seed("actions", c.rows("actions"), { complete: false });
    const { result, summary } = safetyPulse(c, {}, NOW);
    expect(result.caveats.some((x) => x.includes('"actions" was only partially synced'))).toBe(true);
    expect(summary).toContain("25 inspections completed (previous 22, up)");
  });

  it("direction rule", () => {
    expect(direction(5, 4, 20, 20)).toBe("up");
    expect(direction(5, 4, 19, 20)).toBe("too few to compare");
    expect(direction(4, 4, 30, 30)).toBe("no change");
    expect(direction(null, 4, 30, 30)).toBe("too few to compare");
  });
});
