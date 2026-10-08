import { describe, expect, it } from "vitest";
import type { FeedName, FeedStatus } from "../../src/cache/contract.js";
import { feedProblem, feedUsable } from "../../src/analytics/common.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { analyzeFailedItems } from "../../src/analytics/failed-items.js";
import { analyzeCompare, reportP } from "../../src/analytics/compare.js";
import { computeHotspots } from "../../src/analytics/hotspots.js";
import { computeTrend } from "../../src/analytics/trend.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";

/**
 * Fail closed: a feed that could not be read must never be reported as 0.
 * Feed states mirror what the sync engine records (src/cache/sync.ts, src/cache/index.ts).
 */

const NOW = new Date("2026-10-08T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const SYNCED = "2026-10-08T11:30:00.000Z";

type Patch = Partial<Omit<FeedStatus, "feed">>;

/** FakeCache whose sync state can be overridden per feed. */
class StateCache extends FakeCache {
  private patches = new Map<FeedName, Patch>();
  state(feed: FeedName, patch: Patch): this {
    this.patches.set(feed, patch);
    return this;
  }
  override status(feeds?: FeedName[]): FeedStatus[] {
    return super.status(feeds).map((s) => ({ ...s, ...(this.patches.get(s.feed) ?? {}) }));
  }
}

/** The states in which a feed's rows cannot back a figure. `rows` is what the cache holds in that state. */
const UNUSABLE: Array<{ name: string; keepRows: boolean; patch: Patch; reason: RegExp }> = [
  {
    name: "refused on first sync (HTTP 403)",
    keepRows: false,
    patch: { last_synced_at: SYNCED, complete: true, unavailable: "HTTP 403: no permission" },
    reason: /could not be read \(HTTP 403: no permission\)/,
  },
  {
    name: "failed on first sync (HTTP 500)",
    keepRows: false,
    patch: { last_synced_at: null, complete: false, last_error: "Mitti API 500: internal error" },
    reason: /could not be read \(Mitti API 500: internal error\)/,
  },
  {
    name: "access lost after earlier syncs (stale rows kept)",
    keepRows: true,
    patch: { last_synced_at: SYNCED, complete: false, unavailable: "HTTP 403: no permission", last_error: "Access refused on refresh: HTTP 403: no permission" },
    reason: /could not be read \(HTTP 403: no permission\)/,
  },
  {
    name: "still downloading for the first time",
    keepRows: true,
    patch: { last_synced_at: null, complete: false, last_error: "SYNCING: still downloading in the background" },
    reason: /still downloading/,
  },
  { name: "never synced", keepRows: false, patch: { last_synced_at: null, complete: false }, reason: /never been synced/ },
];

// 52 open actions, 40 of them overdue, plus completed ones, so any leak of stale rows would show.
function actionRows(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 52; i++)
    rows.push({ id: `a${i}`, title: `Fix ${i}`, status: "To do", priority: i < 5 ? "High" : "Low", site_id: "site-1", created_at: ago(20 + i), due_date: i < 40 ? ago(3 + i) : ago(-10) });
  for (let i = 0; i < 6; i++) rows.push({ id: `d${i}`, status: "Complete", priority: "Low", site_id: "site-1", created_at: ago(10), completed_at: ago(2) });
  return rows;
}

function inspectionRows(prefix: string, n: number, day: string, failed: (i: number, q: number) => boolean) {
  const insp: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const id = `audit_${prefix}${i}`;
    insp.push({ id, archived: false, date_completed: `${day}T10:00:00Z`, site_id: "site-1", template_id: "template_t1", score_percentage: 80, max_score: 10 });
    for (let q = 1; q <= 4; q++) items.push({ id: `${id}-${q}`, audit_id: id, template_id: "template_t1", label: `Q${q}`, type: "question", response: "x", is_failed_response: failed(i, q) });
  }
  return { insp, items };
}

/** A complete cache for every feed the analytics read; `broken` is then put into an unusable state. */
function cacheWith(broken: FeedName | undefined, u: (typeof UNUSABLE)[number] | undefined) {
  const cur = inspectionRows("c", 25, "2026-10-05", (i, q) => q === 1);
  const prev = inspectionRows("p", 22, "2026-09-28", (i, q) => q === 1 && i < 4);
  const data: Partial<Record<FeedName, Record<string, unknown>[]>> = {
    inspections: [...cur.insp, ...prev.insp],
    inspection_items: [...cur.items, ...prev.items],
    actions: actionRows(),
    issues: [
      { id: "iss1", title: "Gas smell", priority: "High", created_at: "2026-10-06T08:00:00Z", site_id: "site-1", category_label: "Hazard" },
      { id: "iss2", title: "Loose rail", priority: "Low", created_at: "2026-10-05T08:00:00Z", site_id: "site-1", category_label: "Hazard" },
    ],
    templates: [{ id: "template_t1", name: "Demo Walkthrough" }],
    sites: [],
    schedule_occurrences: [],
  };
  const c = new StateCache();
  for (const [feed, rows] of Object.entries(data) as Array<[FeedName, Record<string, unknown>[]]>) {
    if (feed === broken && u && !u.keepRows) {
      if (u.name !== "never synced") c.seed(feed, []);
    } else c.seed(feed, rows);
  }
  if (broken && u) c.state(broken, u.patch);
  return c;
}

describe("feedUsable", () => {
  for (const u of UNUSABLE)
    it(`is false when the feed is ${u.name}, with the reason`, () => {
      const c = cacheWith("actions", u);
      expect(feedUsable(c, "actions")).toBe(false);
      expect(feedProblem(c, "actions")).toMatch(u.reason);
    });

  it("is true for a feed that synced successfully but is empty (a true zero)", () => {
    const c = new StateCache().seed("actions", []);
    expect(feedUsable(c, "actions")).toBe(true);
  });

  it("stays true when a refresh failed over a complete earlier snapshot (stale, not missing)", () => {
    const c = new StateCache().seed("actions", actionRows()).state("actions", { complete: true, last_error: "Mitti API 500: internal error" });
    expect(feedUsable(c, "actions")).toBe(true);
  });
});

describe("action backlog fails closed", () => {
  for (const u of UNUSABLE)
    it(`actions feed ${u.name}: every figure is null and the summary says unavailable`, () => {
      const { summary, result } = analyzeActionBacklog(cacheWith("actions", u), {}, NOW);
      for (const [k, v] of Object.entries(result.metrics)) expect(v, k).toBeNull();
      expect(result.table).toEqual([]);
      expect(result.weekly).toEqual([]);
      expect(result.oldest_open).toEqual([]);
      expect(summary).toMatch(/^Action figures unavailable: the actions feed /);
      expect(summary).toMatch(u.reason);
      expect(summary).not.toMatch(/\b0 open actions|\b0 overdue/);
    });

  it("a successfully synced empty actions feed still reports 0 with the empty-feed caveat", () => {
    const c = new StateCache().seed("actions", []).seed("sites", []).seed("templates", []).seed("users", []);
    const { summary, result } = analyzeActionBacklog(c, {}, NOW);
    expect(result.metrics).toMatchObject({ open: 0, overdue: 0, age_0_7: 0, completed_in_period: 0, opened_in_period: 0, closed_in_period: 0 });
    expect(summary).toMatch(/^0 open actions: 0 overdue/);
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "actions" is empty/));
  });

  it("the healthy fixture reports the real backlog (52 open, 40 overdue)", () => {
    const { result } = analyzeActionBacklog(cacheWith(undefined, undefined), {}, NOW);
    expect(result.metrics).toMatchObject({ open: 52, overdue: 40 });
  });
});

describe("safety pulse fails closed", () => {
  for (const u of UNUSABLE)
    it(`actions feed ${u.name}: action metrics are null, their rows omitted, summary says unavailable`, () => {
      const { summary, result } = safetyPulse(cacheWith("actions", u), {}, NOW);
      for (const k of ["actions_created", "actions_created_previous", "actions_created_delta", "actions_completed", "actions_completed_previous", "actions_completed_delta", "open_overdue_actions", "oldest_overdue_action_age_days", "max_days_overdue"])
        expect(result.metrics[k], k).toBeNull();
      expect(result.table.map((r) => r.metric)).not.toEqual(expect.arrayContaining(["actions_created"]));
      expect(result.table.some((r) => r.metric.startsWith("actions_") || r.metric === "open_overdue_actions")).toBe(false);
      expect(result.attention.some((a) => a.kind === "overdue_high_priority_action")).toBe(false);
      expect(summary).toContain("Action figures unavailable: the actions feed ");
      expect(summary).not.toMatch(/actions created|open overdue actions/);
      // Other figures are unaffected.
      expect(result.metrics.inspections_completed).toBe(25);
      expect(result.metrics.new_issues).toBe(2);
    });

  it("inspection_items unusable: failed-item rate, failed and answered counts are null and the row is omitted", () => {
    const { summary, result } = safetyPulse(cacheWith("inspection_items", UNUSABLE[0]), {}, NOW);
    for (const k of ["failed_item_rate", "failed_item_rate_previous", "failed_item_rate_delta", "answered_items", "failed_items"]) expect(result.metrics[k], k).toBeNull();
    expect(result.table.some((r) => r.metric === "failed_item_rate")).toBe(false);
    expect(summary).toContain("Failed-item figures unavailable: the inspection_items feed could not be read (HTTP 403: no permission).");
    expect(summary).not.toMatch(/0 answered items/);
  });

  it("issues unusable: new_issues is null and the row is omitted", () => {
    const { summary, result } = safetyPulse(cacheWith("issues", UNUSABLE[1]), {}, NOW);
    for (const k of ["new_issues", "new_issues_previous", "new_issues_delta"]) expect(result.metrics[k], k).toBeNull();
    expect(result.table.some((r) => r.metric === "new_issues")).toBe(false);
    expect(result.attention.some((a) => a.kind === "new_high_priority_issue")).toBe(false);
    expect(summary).toContain("Issue figures unavailable: the issues feed could not be read (Mitti API 500: internal error).");
    expect(summary).not.toMatch(/new issues/);
  });

  it("successfully synced empty feeds still give zeros with the empty-feed caveat", () => {
    const c = cacheWith(undefined, undefined).seed("actions", []).seed("issues", []);
    const { summary, result } = safetyPulse(c, {}, NOW);
    expect(result.metrics).toMatchObject({ actions_created: 0, actions_completed: 0, open_overdue_actions: 0, new_issues: 0 });
    expect(summary).toMatch(/0 new issues, 0 actions created vs 0 completed, 0 open overdue actions/);
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "actions" is empty/));
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "issues" is empty/));
  });
});

describe("failed items fail closed", () => {
  for (const u of UNUSABLE)
    it(`inspection_items feed ${u.name}: failed, answered and groups are null`, () => {
      const { summary, result } = analyzeFailedItems(cacheWith("inspection_items", u), { period: "last 30 days" }, NOW);
      expect(result.metrics).toMatchObject({ failed_items: null, answered_items: null, failure_rate_pct: null, groups_with_failures: null, top_group_share_pct: null });
      expect(result.metrics.inspections).toBe(47);
      expect(result.table).toEqual([]);
      expect(summary).toMatch(/^Failed-item figures unavailable: the inspection_items feed /);
      expect(summary).not.toMatch(/\b0 failed items|out of 0 answered/);
    });

  it("a successfully synced empty items feed still reports 0 with the empty-feed caveat", () => {
    const c = cacheWith(undefined, undefined).seed("inspection_items", []);
    const { result } = analyzeFailedItems(c, { period: "last 30 days" }, NOW);
    expect(result.metrics).toMatchObject({ failed_items: 0, answered_items: 0, groups_with_failures: 0 });
    expect(result.caveats).toContainEqual(expect.stringMatching(/Feed "inspection_items" is empty/));
  });
});

describe("compare, hotspots and trend fail closed", () => {
  it("compare omits measures whose feed cannot be read", () => {
    const c = cacheWith("inspection_items", UNUSABLE[0]);
    c.state("actions", UNUSABLE[1]!.patch).seed("actions", []);
    const { summary, result } = analyzeCompare(c, { period_a: "2026-10-02..2026-10-08", period_b: "2026-09-25..2026-10-01" }, NOW);
    expect(result.table.map((r) => r.measure)).toEqual(["average_score"]);
    expect(result.metrics).toMatchObject({ a_failed_items: null, a_answered_items: null, b_failed_items: null, b_answered_items: null });
    expect(summary).toContain("Failed-item figures unavailable");
    expect(summary).toContain("Action figures unavailable");
  });

  it("hotspots: issues feed unusable gives null counts and no rows", () => {
    const period = parsePeriod("last 30 days", NOW);
    const { summary, result } = computeHotspots(cacheWith("issues", UNUSABLE[0]), { period, limit: 10 }, NOW);
    expect(result.metrics).toMatchObject({ issues: null, previous_period_issues: null, categories: null, rising_categories: null });
    expect(result.table).toEqual([]);
    expect(summary).toMatch(/^Issue figures unavailable/);
  });

  it("trend: an unreadable source feed gives no buckets and a null total", () => {
    const period = parsePeriod("last 90 days", NOW);
    const { summary, result } = computeTrend(cacheWith("actions", UNUSABLE[0]), { metric: "actions_created", grain: "week", period }, NOW);
    expect(result.table).toEqual([]);
    expect(result.metrics.total).toBeNull();
    expect(summary).toMatch(/^Actions created figures unavailable/);
  });
});

describe("compare p-values are never shown as 0", () => {
  it("a p of 6e-10 is not rendered as 0", () => {
    expect(reportP(6e-10)).not.toBe(0);
    expect(reportP(6e-10)).toBe("< 0.0001");
    expect(reportP(0)).toBe("< 0.0001");
    expect(reportP(0.028534)).toBe(0.0285);
    expect(reportP(0.5)).toBe(0.5);
  });

  it("a very significant failed-item difference reports p as < 0.0001, not 0", () => {
    const a = inspectionRows("a", 100, "2026-10-05", (i, q) => q <= 2);
    const b = inspectionRows("b", 100, "2026-09-28", (i, q) => q === 1 && i < 3);
    const c = new StateCache()
      .seed("inspections", [...a.insp, ...b.insp])
      .seed("inspection_items", [...a.items, ...b.items])
      .seed("actions", [])
      .seed("sites", []);
    const { result } = analyzeCompare(c, { period_a: "2026-10-02..2026-10-08", period_b: "2026-09-25..2026-10-01" }, NOW);
    const fr = result.table.find((r) => r.measure === "failed_item_rate")!;
    expect(fr.verdict).toBe("real difference");
    expect(fr.p_value).not.toBe(0);
    expect(fr.p_value).toBe("< 0.0001");
  });
});
