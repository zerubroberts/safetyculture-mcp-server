import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, previousPeriod, type Period } from "../core/time.js";
import { coverage, coverageCaveats, feedProblem, unavailableSentence } from "../analytics/common.js";
import { safetyPulse, type PulseRow } from "../analytics/pulse.js";
import { analyzeFailedItems, canon, completedInspections, DAY } from "../analytics/failed-items.js";
import { analyzeActionBacklog, isOverdue, loadActions, wholeDays } from "../analytics/backlog.js";
import { analyzeScheduleCompliance } from "../analytics/schedule-compliance.js";
import { analyzeSiteLeague } from "../analytics/league.js";
import { buckets, computeTrend, isoDay, siteKey, type Grain, type TrendMetric } from "../analytics/trend.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import { round } from "../analytics/stats.js";
import { coverageTable, orgFingerprint, siteNameMap } from "../reports/sections.js";
import { fmtInstant, safeHref } from "../reports/model.js";
import { buildIndex, earliestCompleted, memoReader, occurrenceWindow, siteScoped, type BuildIndex } from "./reader.js";

/**
 * Dashboard data: every figure the dashboard can show, precomputed at build time for each period preset and
 * each site filter. The figures are the analytics' own outputs (safetyPulse, analyzeFailedItems,
 * analyzeActionBacklog, analyzeScheduleCompliance, analyzeSiteLeague, computeTrend, computeInspectorActivity,
 * completedInspections, loadActions); the browser only picks a slice, filters, sorts and draws. Values the
 * analytics withhold (unreadable feed) stay null and carry the analytic's reason, so the page can say
 * "unavailable" instead of drawing a zero.
 */

export const DASHBOARD_FEEDS: FeedName[] = ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "schedules", "schedule_assignees", "sites", "templates", "users"];

/** Period presets offered by the switcher. A requested period that matches none is added as "Custom". */
export const PRESETS = [
  { key: "7d", text: "last 7 days", short: "7d", long: "Last 7 days" },
  { key: "30d", text: "last 30 days", short: "30d", long: "Last 30 days" },
  { key: "90d", text: "last 90 days", short: "90d", long: "Last 90 days" },
  { key: "12m", text: "last 12 months", short: "12m", long: "Last 12 months" },
] as const;

/** At most this many individual sites get their own precomputed slices; "All sites" always covers every site. */
export const MAX_SITES = 25;
/** Sites need this many completed inspections in a period to be ranked in the league and dumbbell. */
export const LEAGUE_MIN_INSPECTIONS = 5;
/** Failed-item Pareto depth. */
export const PARETO_TOP = 15;

export interface DashboardArgs {
  period?: string;
  site_ids?: string[];
}

type Num = number | null;

export interface DashTile {
  key: string;
  label: string;
  value: Num;
  unit: string;
  previous: Num;
  delta: Num;
  good?: "up" | "down";
  note?: string;
  /** Why the figure is withheld; the page shows "Unavailable" and this text, never 0. */
  unavailable?: string;
  /** Trend series (scope.trends key) or "missed" (scope.stripes) drawn as the tile sparkline. */
  spark?: string;
  /** Observations behind the current and previous value (the pulse's n_current / n_previous). */
  n_current?: number;
  n_previous?: number;
}

export interface TrendSeries {
  unavailable: string | null;
  unit: string;
  grain: Grain;
  direction: string | null;
  /** `from` is the bucket's first day (clipped to the window); the next bucket's `from`, or the window end, closes it. */
  points: Array<{ bucket: string; from: string; value: Num; n: number; partial: boolean; change: Num }>;
}

const TREND_METRICS: TrendMetric[] = ["inspections_completed", "average_score", "failed_item_rate", "issues_created", "actions_created", "actions_completed"];

const dayIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const rangeText = (from: number, to: number) => `${dayIso(from)}..${dayIso(to - DAY)}`;
const prevText = (p: Period) => {
  const q = previousPeriod(p);
  return rangeText(q.from.getTime(), q.to.getTime());
};
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const num = (v: unknown): Num => (v === null || v === undefined || v === "" ? null : Number(v));

// ---------------------------------------------------------------- tiles

const PULSE_TILES: Array<{ key: string; label: string; unit: string; good?: "up" | "down"; spark?: string; feeds: FeedName[] }> = [
  { key: "inspections_completed", label: "Inspections completed", unit: "", good: "up", spark: "inspections_completed", feeds: ["inspections"] },
  { key: "average_score", label: "Average score", unit: "%", good: "up", spark: "average_score", feeds: ["inspections"] },
  { key: "failed_item_rate", label: "Failed-item rate", unit: "%", good: "down", spark: "failed_item_rate", feeds: ["inspection_items", "inspections"] },
  { key: "open_overdue_actions", label: "Open overdue actions", unit: "", feeds: ["actions"] },
  { key: "missed_scheduled_inspections", label: "Missed scheduled inspections", unit: "", good: "down", spark: "missed", feeds: ["schedule_occurrences"] },
  { key: "new_issues", label: "Issues reported", unit: "", spark: "issues_created", feeds: ["issues"] },
];

const ACTION_TILES: typeof PULSE_TILES = [
  { key: "actions_created", label: "Actions created", unit: "", spark: "actions_created", feeds: ["actions"] },
  { key: "actions_completed", label: "Actions completed", unit: "", good: "up", spark: "actions_completed", feeds: ["actions"] },
];

/** KPI tiles straight from the safety pulse rows: a change is only given where the pulse states a direction. */
function pulseTiles(cache: CacheReader, rows: PulseRow[], maxDaysOverdue: Num, specs = PULSE_TILES): DashTile[] {
  return specs.map((t) => {
    const row = rows.find((r) => r.metric === t.key);
    const base = { key: t.key, label: t.label, unit: t.unit, good: t.good, spark: t.spark };
    if (!row) {
      const problem = t.feeds.map((f) => feedProblem(cache, f)).find(Boolean);
      const reason = problem ?? (t.key === "missed_scheduled_inspections" ? "no schedule occurrences are cached" : "not reported by the safety pulse");
      return { ...base, value: null, previous: null, delta: null, unavailable: reason };
    }
    if (row.direction === "snapshot")
      return { ...base, value: row.current, previous: null, delta: null, note: row.current && maxDaysOverdue !== null ? `snapshot now; most overdue ${maxDaysOverdue} days` : "snapshot now" };
    const enough = row.direction !== "too few to compare";
    return {
      ...base,
      value: row.current,
      previous: row.previous,
      delta: enough ? row.delta : null,
      note: enough ? undefined : `too few to compare (${row.n_current} vs ${row.n_previous} observations; needs 20 each)`,
      n_current: row.n_current,
      n_previous: row.n_previous,
    };
  });
}

// ---------------------------------------------------------------- scope-level (period independent)

function trendSeries(cache: CacheReader, metric: TrendMetric, grain: Grain, period: Period, siteIds: string[] | undefined, now: Date): TrendSeries {
  const { result, summary } = computeTrend(cache, { metric, grain, period, site_ids: siteIds }, now);
  const unit = metric === "average_score" || metric === "failed_item_rate" ? "%" : "";
  if (result.metrics.buckets === null) return { unavailable: summary, unit, grain, direction: null, points: [] };
  return {
    unavailable: null,
    unit,
    grain,
    direction: result.metrics.direction === null ? null : String(result.metrics.direction),
    points: result.table.map((r, i) => {
      const prev = result.table[i - 1];
      const change = r.value !== null && prev && prev.value !== null ? round(r.value - prev.value, unit ? 2 : 0) : null;
      return { bucket: r.bucket, from: r.from.slice(0, 10), value: r.value, n: r.n, partial: r.partial, change };
    }),
  };
}

/**
 * Inspections per day over the last 12 months (core completedInspections, counted by UTC day of completion).
 * Days before the first cached inspection are null ("no records yet"), not zero. Change vs the same weekday a
 * week earlier and the day's rank within its month are worked out here so the page never computes them.
 */
function calendar(cache: CacheReader, siteIds: string[] | undefined, now: Date, earliest: number | undefined) {
  const period = parsePeriod("last 12 months", now);
  const problem = feedProblem(cache, "inspections");
  if (problem) return { unavailable: unavailableSentence("Inspections per day", problem), start: dayIso(period.from.getTime()), values: [], delta_week: [], month_rank: [] };
  const counts = new Map<string, number>();
  for (const i of completedInspections(cache, period, { site_ids: siteIds }).values()) {
    const d = isoDay(i.completed_ms);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const firstDay = earliest === undefined ? undefined : Date.UTC(new Date(earliest).getUTCFullYear(), new Date(earliest).getUTCMonth(), new Date(earliest).getUTCDate());
  const values: Num[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += DAY) values.push(firstDay === undefined || t < firstDay ? null : (counts.get(dayIso(t)) ?? 0));
  const delta_week = values.map((v, i) => (v === null || i < 7 || values[i - 7] === null ? null : v - (values[i - 7] as number)));
  const months = values.map((_, i) => dayIso(period.from.getTime() + i * DAY).slice(0, 7));
  const inMonth = new Map<string, number[]>();
  values.forEach((v, i) => {
    if (v !== null) inMonth.set(months[i]!, [...(inMonth.get(months[i]!) ?? []), v]);
  });
  const month_rank = values.map((v, i) => (v === null ? null : 1 + (inMonth.get(months[i]!) ?? []).filter((w) => w > v).length));
  return { unavailable: null, start: dayIso(period.from.getTime()), values, delta_week, month_rank };
}

/**
 * Schedule compliance per week over the last 12 months: analyzeScheduleCompliance run once per week (the
 * weeks are the trend analytic's Monday buckets, clipped to the window). Each call sees only that week's
 * occurrences, which is exactly what the analytic's own period filter would keep.
 */
function stripes(cache: CacheReader, siteIds: string[] | undefined, now: Date, index: BuildIndex) {
  const period = parsePeriod("last 12 months", now);
  const problem = feedProblem(cache, "schedule_occurrences");
  if (problem) return { state: "unavailable" as const, reason: `${unavailableSentence("Schedule compliance", problem)} This is not 0% or 100% compliance.`, weeks: [] };
  if (cache.rows("schedule_occurrences").length === 0)
    return { state: "empty" as const, reason: "Nothing was scheduled: the schedule occurrences feed is synced and empty, so there is no compliance rate to report.", weeks: [] };
  const weeks = buckets(period, "week").map((b) => {
    const { reader, occurrences } = occurrenceWindow(cache, b.from, b.to, index);
    const base = { week: b.label, from: dayIso(b.from), to: dayIso(b.to - DAY), partial: b.partial };
    if (!occurrences) return { ...base, due: 0, on_time: 0, late: 0, missed: 0, pending: 0, resolved: 0, compliance_pct: null as Num };
    const m = analyzeScheduleCompliance(reader, { period: rangeText(b.from, b.to), site_ids: siteIds }, now).result.metrics;
    return { ...base, due: num(m.due) ?? 0, on_time: num(m.on_time) ?? 0, late: num(m.late) ?? 0, missed: num(m.missed) ?? 0, pending: num(m.pending) ?? 0, resolved: num(m.resolved) ?? 0, compliance_pct: num(m.compliance_pct) };
  });
  const rated = weeks.filter((w) => w.compliance_pct !== null);
  return {
    state: "ok" as const,
    reason: null,
    weeks: weeks.map((w, i) => {
      const prev = weeks[i - 1];
      return {
        ...w,
        change_pp: w.compliance_pct !== null && prev && prev.compliance_pct !== null ? round(w.compliance_pct - prev.compliance_pct, 1) : null,
        /** 1 = the week with the lowest on-time share. */
        rank_low: w.compliance_pct === null ? null : 1 + rated.filter((x) => (x.compliance_pct as number) < (w.compliance_pct as number)).length,
        rated_weeks: rated.length,
      };
    }),
  };
}

/** Every open action as one dot (core loadActions; open, age and overdue as the backlog analytic defines them). */
function openActions(cache: CacheReader, siteIds: string[] | undefined, now: Date) {
  const problem = feedProblem(cache, "actions");
  if (problem) return { unavailable: unavailableSentence("Action figures", problem), rows: [], undated: 0 };
  const names = siteNameMap(cache);
  const t = now.getTime();
  const open = loadActions(cache, { site_ids: siteIds }).filter((a) => a.open);
  const rows = open
    .filter((a) => a.created_ms !== undefined)
    .map((a) => ({
      id: a.id,
      title: a.title ?? "(untitled action)",
      sk: a.site_id ? (siteKey(a.site_id) ?? "") : "",
      site: a.site_id ? (names.get(siteKey(a.site_id) ?? "") ?? a.site_id) : "(no site)",
      priority: a.priority,
      age_days: wholeDays(a.created_ms!, t),
      due: a.due_ms !== undefined ? isoDay(a.due_ms) : null,
      overdue_days: isOverdue(a, t) ? wholeDays(a.due_ms!, t) : null,
      href: safeHref(links.action(a.id)) ?? null,
    }))
    .sort((x, y) => y.age_days - x.age_days || x.id.localeCompare(y.id));
  return { unavailable: null, rows, undated: open.length - rows.length };
}

// ---------------------------------------------------------------- slices (period x scope)

function overviewSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date) {
  const pulse = safetyPulse(cache, { period: periodText, site_ids: siteIds }, now);
  const r = pulse.result;
  const tiles = pulseTiles(cache, r.table, num(r.metrics.max_days_overdue));
  const tile = (k: string) => tiles.find((x) => x.key === k)!;
  const fr = tile("failed_item_rate");
  const ins = tile("inspections_completed");
  const od = tile("open_overdue_actions");
  const frText =
    fr.value === null
      ? `Failed-item rate unavailable (${fr.unavailable})`
      : `Failed-item rate is ${fr.value}%` +
        (fr.delta === null ? `, ${fr.note ?? "too few to compare"}` : fr.delta === 0 ? ", level with the previous period" : `, ${Math.abs(fr.delta)} points ${fr.delta < 0 ? "lower" : "higher"} than the previous period`);
  const answer = `${frText}. ${ins.value === null ? "Inspection count unavailable" : plural(ins.value, "inspection")} completed; ${od.value === null ? "overdue actions unavailable" : `${plural(od.value, "action")} overdue now`}.`;
  return {
    tiles,
    action_tiles: pulseTiles(cache, r.table, null, ACTION_TILES),
    attention: r.attention.map((a) => ({ severity: a.severity, kind: a.kind, text: a.detail, href: safeHref(a.link) ?? null })),
    answer,
    summary: pulse.summary,
    period_label: r.period?.label ?? periodText,
    previous_label: r.previous_period.label,
    caveats: r.caveats.filter((c) => !c.startsWith("Feed ") && !c.startsWith("The latest refresh")),
  };
}

function inspectionsSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date) {
  const cur = analyzeFailedItems(cache, { period: periodText, site_ids: siteIds, group_by: "item", top: PARETO_TOP }, now);
  const m = cur.result.metrics;
  if (m.failed_items === null)
    return { unavailable: cur.summary, failed: null, answered: null, rate: null, inspections: num(m.inspections), groups: null, rows: [], answer: cur.summary, caveats: cur.result.caveats.filter((c) => !c.startsWith("Feed ")) };
  const prev = analyzeFailedItems(cache, { period: prevText(parsePeriod(periodText, now)), site_ids: siteIds, group_by: "item", top: 100_000 }, now);
  const prevOk = prev.result.metrics.failed_items !== null;
  const prevBy = new Map(prev.result.table.map((r) => [r.key, r.failed]));
  const rows = cur.result.table.map((r, i) => ({
    rank: i + 1,
    label: r.group,
    template: r.template ?? "",
    failed: r.failed,
    answered: r.answered,
    rate: r.failure_rate_pct,
    share: r.share_pct,
    cumulative: r.cumulative_share_pct,
    previous: prevOk ? (prevBy.get(r.key) ?? 0) : null,
    change: prevOk ? r.failed - (prevBy.get(r.key) ?? 0) : null,
    href: r.example_inspections[0] ? (safeHref(r.example_inspections[0].link) ?? null) : null,
  }));
  const failed = num(m.failed_items) ?? 0;
  const groups = num(m.groups_with_failures) ?? 0;
  const half = rows.find((r) => (r.cumulative ?? 0) >= 50);
  const answer = !failed
    ? `No failed answers in this period (${plural(num(m.answered_items) ?? 0, "answered item")} across ${plural(num(m.inspections) ?? 0, "inspection")}).`
    : half
      ? `${half.rank === 1 ? "One question accounts" : `${half.rank} questions account`} for ${half.cumulative}% of the ${failed.toLocaleString("en-US")} failed answers (${groups} questions failed at least once).`
      : `The top ${rows.length} questions account for ${rows[rows.length - 1]?.cumulative ?? 0}% of the ${failed.toLocaleString("en-US")} failed answers; failures are spread widely.`;
  return {
    unavailable: null,
    failed,
    answered: num(m.answered_items),
    rate: num(m.failure_rate_pct),
    inspections: num(m.inspections),
    groups,
    previous_failed: prevOk ? num(prev.result.metrics.failed_items) : null,
    failed_change: prevOk ? failed - (num(prev.result.metrics.failed_items) ?? 0) : null,
    /** Rows (largest first) needed to reach half of all failed answers: the "vital few" the page highlights. */
    vital: half?.rank ?? null,
    rows,
    answer,
    caveats: cur.result.caveats.filter((c) => !c.startsWith("Feed ")),
  };
}

function actionsSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date) {
  const { summary, result } = analyzeActionBacklog(cache, { period: periodText, site_ids: siteIds }, now);
  const m = result.metrics;
  if (m.open === null) return { unavailable: summary, metrics: m, weekly: [], by_site: [], by_priority: [], answer: summary, caveats: result.caveats.filter((c) => !c.startsWith("Feed ")) };
  const oldest = result.oldest_open[0]?.age_days as number | undefined;
  const byPriority = analyzeActionBacklog(cache, { period: periodText, site_ids: siteIds, group_by: "priority" }, now).result.table;
  const answer =
    `${plural(Number(m.open), "open action")}, ${Number(m.overdue).toLocaleString("en-US")} overdue` +
    (oldest !== undefined ? `; the oldest has been open ${plural(oldest, "day")}` : "") +
    `. ${Number(m.opened_in_period).toLocaleString("en-US")} opened and ${Number(m.closed_in_period).toLocaleString("en-US")} closed in the period, so the backlog ${Number(m.opened_in_period) > Number(m.closed_in_period) ? "grew" : Number(m.opened_in_period) < Number(m.closed_in_period) ? "shrank" : "held level"}.`;
  return {
    unavailable: null,
    metrics: m,
    weekly: result.weekly,
    by_site: result.table.map((g) => ({ group: g.group, sk: g.key, open: g.open, overdue: g.overdue, no_due_date: g.no_due_date, oldest_age_days: g.oldest_age_days })),
    by_priority: byPriority.map((g) => ({ priority: g.key, open: g.open, overdue: g.overdue })),
    answer,
    caveats: result.caveats.filter((c) => !c.startsWith("Feed ")),
  };
}

function schedulesSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date, withSites: boolean) {
  const { summary, result } = analyzeScheduleCompliance(cache, { period: periodText, site_ids: siteIds }, now);
  const problem = feedProblem(cache, "schedule_occurrences");
  const state = problem ? "unavailable" : cache.rows("schedule_occurrences").length === 0 ? "empty" : "ok";
  const m = result.metrics;
  const prev = state === "ok" ? analyzeScheduleCompliance(cache, { period: prevText(parsePeriod(periodText, now)), site_ids: siteIds }, now).result.metrics : null;
  const change = (k: string) => (prev && m[k] !== null && prev[k] !== null && m[k] !== undefined && prev[k] !== undefined ? round(Number(m[k]) - Number(prev[k]), 1) : null);
  const bySite = withSites && state === "ok" ? analyzeScheduleCompliance(cache, { period: periodText, site_ids: siteIds, group_by: "site" }, now).result.table : [];
  const row = (r: (typeof result.table)[number]) => ({ group: r.group, due: r.due, on_time: r.on_time, late: r.late, missed: r.missed, wont_do: r.wont_do, pending: r.pending, resolved: r.resolved, compliance_pct: r.compliance_pct });
  const answer =
    state === "unavailable"
      ? `${summary} This is not 0% or 100% compliance.`
      : state === "empty"
        ? summary
        : m.compliance_pct === null
          ? summary
          : `${m.compliance_pct}% of resolved scheduled inspections were done on time (${Number(m.on_time).toLocaleString("en-US")} of ${Number(m.resolved).toLocaleString("en-US")}); ${Number(m.late).toLocaleString("en-US")} late and ${Number(m.missed).toLocaleString("en-US")} missed.`;
  return {
    state,
    reason: state === "ok" ? null : answer,
    metrics: m,
    previous: prev,
    changes: { compliance_pct: change("compliance_pct"), late_pct: change("late_pct"), missed_pct: change("missed_pct"), due: change("due") },
    by_schedule: result.table.map(row),
    by_site: bySite.map(row),
    answer,
    caveats: result.caveats.filter((c) => !c.startsWith("Feed ")),
  };
}

function teamSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date) {
  const period = parsePeriod(periodText, now);
  const { result, summary } = computeInspectorActivity(cache, { period, site_ids: siteIds, limit: 50 }, now);
  const tq = analyzeFailedItems(cache, { period: periodText, site_ids: siteIds, group_by: "template", top: 25 }, now);
  const inspectorsUnavailable = result.metrics.inspections === null ? summary : null;
  const templatesUnavailable = tq.result.metrics.failed_items === null ? tq.summary : null;
  const templates = tq.result.table.map((r) => ({ group: r.group, failed: r.failed, answered: r.answered, rate: r.failure_rate_pct, share: r.share_pct }));
  const worst = [...templates].filter((t) => t.answered >= 20 && t.rate !== null).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
  const answer = inspectorsUnavailable
    ? inspectorsUnavailable
    : `${plural(Number(result.metrics.inspectors), "inspector")} completed ${plural(Number(result.metrics.inspections), "inspection")}.` +
      (templatesUnavailable ? ` ${templatesUnavailable}` : worst ? ` Highest failed-item rate: "${worst.group}" at ${worst.rate}% of ${worst.answered.toLocaleString("en-US")} answered items.` : "");
  return {
    inspectors_unavailable: inspectorsUnavailable,
    inspectors: num(result.metrics.inspectors),
    inspections: num(result.metrics.inspections),
    total: result.total,
    truncated: result.truncated,
    /** Inspections by inspectors outside the top 12 bars (every inspection has one owner, so the rows add up to the total). */
    other_inspections: result.metrics.inspections === null ? null : Number(result.metrics.inspections) - result.table.slice(0, 12).reduce((a, r) => a + r.inspections, 0),
    other_inspectors: Math.max(0, result.total - 12),
    inspector_rows: result.table.map((r) => ({
      inspector_name: r.inspector_name,
      inspections: r.inspections,
      share_pct: result.metrics.inspections ? round((100 * r.inspections) / Number(result.metrics.inspections), 1) : null,
      templates: r.templates,
      median_minutes: r.median_duration_seconds === null ? null : round(r.median_duration_seconds / 60, 1),
      failed_item_rate: r.failed_item_rate,
      expected_rate: r.expected_rate_same_templates,
      difference_pp: r.difference_pp,
      very_fast_share: r.very_fast_share,
    })),
    templates_unavailable: templatesUnavailable,
    templates,
    answer,
    caveats: [...result.caveats, ...tq.result.caveats].filter((c, i, all) => !c.startsWith("Feed ") && all.indexOf(c) === i),
  };
}

function sitesSlice(cache: CacheReader, periodText: string, siteIds: string[] | undefined, now: Date) {
  const cur = analyzeSiteLeague(cache, { period: periodText, site_ids: siteIds, min_inspections: LEAGUE_MIN_INSPECTIONS }, now);
  if (cur.result.metrics.ranked_sites === null) return { unavailable: cur.summary, rows: [], below_minimum: [], answer: cur.summary, caveats: cur.result.caveats.filter((c) => !c.startsWith("Feed ")) };
  const prev = analyzeSiteLeague(cache, { period: prevText(parsePeriod(periodText, now)), site_ids: siteIds, min_inspections: LEAGUE_MIN_INSPECTIONS }, now);
  const prevBy = new Map(prev.result.table.map((r) => [canon(r.site_id), r]));
  const rows = cur.result.table.map((r) => {
    const p = prevBy.get(canon(r.site_id));
    const prevScore = p?.average_score ?? null;
    return {
      rank: r.rank,
      site: r.site,
      sk: siteKey(r.site_id) ?? "",
      inspections: r.inspections,
      average_score: r.average_score,
      previous_average_score: prevScore,
      score_change: r.average_score !== null && prevScore !== null ? round(r.average_score - prevScore, 1) : null,
      previous_inspections: p?.inspections ?? null,
      failed_item_rate: r.failed_item_rate,
      overdue_actions: r.overdue_actions,
      median_resolution_days: r.median_resolution_days,
      composite: r.composite,
      rank_change: r.rank_change,
    };
  });
  const moved = rows.filter((r) => r.score_change !== null).sort((a, b) => (b.score_change ?? 0) - (a.score_change ?? 0));
  const up = moved[0];
  const down = moved[moved.length - 1];
  const answer = !rows.length
    ? cur.summary
    : moved.length < 2
      ? `${plural(rows.length, "site")} ranked; too few sites qualify in both periods to compare movement.`
      : `${up!.site} improved most (average score ${up!.score_change! > 0 ? "+" : ""}${up!.score_change} points); ${down!.site} ${down!.score_change! < 0 ? `slipped most (${down!.score_change} points)` : "moved least"}. ${plural(rows.length, "site")} ranked, ${moved.filter((r) => (r.score_change ?? 0) < 0).length} scoring lower than the previous period.`;
  return {
    unavailable: null,
    rows,
    below_minimum: cur.result.below_minimum.map((b) => ({ site: b.site, inspections: b.inspections })),
    previous_label: previousPeriod(parsePeriod(periodText, now)).label,
    answer,
    caveats: cur.result.caveats.filter((c) => !c.startsWith("Feed ")),
  };
}

// ---------------------------------------------------------------- the whole build

export interface SiteOption {
  key: string;
  sk: string;
  name: string;
  inspections_12m: number;
}

/** Time after which no further per-site slices are started (the "All sites" slices always complete). */
export const SITE_BUDGET_MS = 45_000;

export function buildDashboardData(base: CacheReader, args: DashboardArgs, now: Date, opts: { budgetMs?: number } = {}) {
  const budgetMs = opts.budgetMs ?? SITE_BUDGET_MS;
  const cache = memoReader(base);
  const requested = args.period ?? "last 90 days";
  const req = parsePeriod(requested, now, "last 90 days");
  const presets: Array<{ key: string; text: string; short: string; long: string }> = PRESETS.map((p) => ({ ...p }));
  const same = (p: Period) => p.from.getTime() === req.from.getTime() && p.to.getTime() === req.to.getTime();
  let defaultKey = presets.find((p) => same(parsePeriod(p.text, now)))?.key;
  if (!defaultKey) {
    presets.push({ key: "custom", text: requested, short: "Custom", long: req.label });
    defaultKey = "custom";
  }

  // Site options: the requested sites, else every site with completed inspections in the last 12 months, busiest first.
  const names = siteNameMap(cache);
  const year = parsePeriod("last 12 months", now);
  const volume = new Map<string, number>();
  for (const i of completedInspections(cache, year, { site_ids: args.site_ids }).values()) if (i.site_id) volume.set(siteKey(i.site_id)!, (volume.get(siteKey(i.site_id)!) ?? 0) + 1);
  const candidates = args.site_ids?.length ? [...new Set(args.site_ids.map((s) => siteKey(s)!).filter(Boolean))] : [...volume.keys()];
  const ranked = candidates.sort((a, b) => (volume.get(b) ?? 0) - (volume.get(a) ?? 0) || (names.get(a) ?? a).localeCompare(names.get(b) ?? b));
  const siteOptions: SiteOption[] = ranked.slice(0, MAX_SITES).map((sk, i) => ({ key: `s${i + 1}`, sk, name: names.get(sk) ?? sk, inspections_12m: volume.get(sk) ?? 0 }));

  const earliest = earliestCompleted(cache);
  const index = buildIndex(cache);
  const windows: Record<string, { period: Period; grain: Grain }> = {
    w: { period: parsePeriod("last 90 days", now), grain: "week" },
    m: { period: year, grain: "month" },
  };
  if (defaultKey === "custom") {
    const days = (req.to.getTime() - req.from.getTime()) / DAY;
    windows.c = { period: req, grain: days <= 120 ? "week" : "month" };
  }
  const windowOf = (key: string) => (key === "custom" ? "c" : key === "12m" ? "m" : "w");

  const scopes = [{ key: "all", ids: args.site_ids?.length ? args.site_ids : undefined }, ...siteOptions.map((o) => ({ key: o.key, ids: [o.sk] }))];
  const scopeData: Record<string, unknown> = {};
  const slices: Record<string, DashboardSlice> = {};
  const started = Date.now();
  const built: string[] = [];
  for (const scope of scopes) {
    // Site filters are a convenience; a very large organisation keeps the busiest sites that fit the budget.
    if (scope.key !== "all" && Date.now() - started > budgetMs) break;
    built.push(scope.key);
    const reader = scope.key === "all" ? cache : siteScoped(cache, scope.ids!, index);
    const trends: Record<string, Record<string, TrendSeries>> = {};
    for (const [wk, w] of Object.entries(windows)) {
      trends[wk] = {};
      for (const metric of TREND_METRICS) trends[wk]![metric] = trendSeries(reader, metric, w.grain, w.period, scope.ids, now);
    }
    scopeData[scope.key] = { trends, calendar: calendar(reader, scope.ids, now, earliest), stripes: stripes(reader, scope.ids, now, index) };
    for (const p of presets) {
      slices[`${p.key}|${scope.key}`] = buildSlice(reader, p.text, scope.ids, now, windowOf(p.key), scope.key === "all");
    }
  }
  const league: Record<string, ReturnType<typeof sitesSlice>> = {};
  for (const p of presets) league[p.key] = sitesSlice(cache, p.text, args.site_ids?.length ? args.site_ids : undefined, now);

  const cov = coverage(cache, DASHBOARD_FEEDS, now);
  const periods = presets.map((p) => {
    const q = parsePeriod(p.text, now);
    return { ...p, from: q.from.toISOString(), to: q.to.toISOString(), label: q.label, previous_label: previousPeriod(q).label };
  });
  const data = {
    version: "dashboard/1",
    fingerprint: orgFingerprint(cache),
    generated_at: fmtInstant(now),
    as_of: now.toISOString(),
    default_period: defaultKey,
    scope_note: args.site_ids?.length ? `${plural(args.site_ids.length, "site")} in scope` : "All sites",
    periods,
    sites: siteOptions.filter((o) => built.includes(o.key)),
    more_sites: Math.max(0, ranked.length - built.length + 1),
    windows: Object.fromEntries(Object.entries(windows).map(([k, w]) => [k, { grain: w.grain, label: w.period.label, from: w.period.from.toISOString(), to: w.period.to.toISOString() }])),
    year: { from: year.from.toISOString(), to: year.to.toISOString(), label: year.label },
    league_min_inspections: LEAGUE_MIN_INSPECTIONS,
    open_actions: openActions(cache, args.site_ids?.length ? args.site_ids : undefined, now),
    scopes: scopeData,
    slices,
    league,
    coverage: coverageTable(cache, DASHBOARD_FEEDS).map((r) => ({ feed: String(r[0]), rows: Number(r[1]), last_synced: String(r[2]), state: String(r[3]) })),
    coverage_caveats: [...new Set(coverageCaveats(cov))],
  };

  const head = slices[`${defaultKey}|all`]!;
  const leagueHead = league[defaultKey]!;
  const t = (k: string) => head.overview.tiles.find((x) => x.key === k)?.value ?? null;
  const metrics = {
    period: periods.find((p) => p.key === defaultKey)!.label,
    inspections_completed: t("inspections_completed"),
    average_score: t("average_score"),
    failed_item_rate: t("failed_item_rate"),
    open_actions: head.actions.unavailable ? null : num(head.actions.metrics.open),
    overdue_actions: head.actions.unavailable ? null : num(head.actions.metrics.overdue),
    schedule_on_time_pct: head.schedules.state === "ok" ? num(head.schedules.metrics.compliance_pct) : null,
    sites_ranked: leagueHead.unavailable ? null : leagueHead.rows.length,
    site_filters: built.length - 1,
  };
  const summary = `Dashboard for ${lower(metrics.period)}: ${head.overview.answer}`;
  return { data, metrics, summary };
}

/** Everything that depends on the period and the site filter. */
function buildSlice(cache: CacheReader, text: string, ids: string[] | undefined, now: Date, window: string, withSites: boolean) {
  return {
    window,
    overview: overviewSlice(cache, text, ids, now),
    inspections: inspectionsSlice(cache, text, ids, now),
    actions: actionsSlice(cache, text, ids, now),
    schedules: schedulesSlice(cache, text, ids, now, withSites),
    team: teamSlice(cache, text, ids, now),
  };
}

export type DashboardData = ReturnType<typeof buildDashboardData>["data"];
export type DashboardSlice = ReturnType<typeof buildSlice>;
