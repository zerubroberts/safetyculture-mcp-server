import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { addMonths, parsePeriod, previousPeriod, type Period } from "../core/time.js";
import { feedProblem, unavailableSentence } from "../analytics/common.js";
import { analyzeActionBacklog, type BacklogRow } from "../analytics/backlog.js";
import { analyzeFailedItems } from "../analytics/failed-items.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import { analyzeSiteLeague, type LeagueRow } from "../analytics/league.js";
import { safetyPulse, type PulseRow } from "../analytics/pulse.js";
import { analyzeScheduleCompliance, type ComplianceRow } from "../analytics/schedule-compliance.js";
import { round } from "../analytics/stats.js";
import { computeTemplateQuality } from "../analytics/template-quality.js";
import { buckets } from "../analytics/trend.js";
import type { BarRow, Block, Cell, Report, Section, Tile } from "./model.js";
import { MIN_N, fmt, humanBucket, humanDay, shortBucket } from "./model.js";
import { plural, pulseSentences, trendSeries, unavailableBlock, withSparks } from "./exhibits.js";
import { CLOSED_NOTE, COMMON_METHODS, TOO_FEW_ANSWERS, TOO_FEW_RESOLVED, ageingBlock, countText, coverageSection, failedBar, gated, metric, overdueBySite, pctText, scopeText, stamp, statusMix, trendChart, type Built } from "./build.js";
import { backlogSummary, orgFingerprint, pulseSections, scheduleSummary, topFailedItems } from "./sections.js";

/**
 * The four extra default reports: monthly board pack, action backlog, schedule compliance and
 * inspection quality. Same rules as build.ts: every figure is read from an analytics function, a
 * feed that cannot be read gives an "unavailable" block with the reason (never a 0), and person
 * names (assignees, inspectors) carry group_kind "person" so strict privacy pseudonymises them.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Period string the analytics accept for a [from, to) window on day boundaries. */
const rangeText = (from: Date, to: Date) => `${iso(from)}..${iso(new Date(to.getTime() - DAY))}`;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const isPersonLabel = (label: string) => label !== "(unassigned)" && label !== "(unknown)";
const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** Partial flags for the backlog's weekly buckets: the same Monday-start weeks the trend analytic clips to the period. */
const weekPartial = (p: Period, weekly: Array<{ week_start: string }>) => {
  const flags = new Map(buckets(p, "week").map((b) => [b.label, b.partial]));
  return weekly.map((w) => flags.get(w.week_start) ?? false);
};
const STATUS_SEGMENTS = [
  { label: "On time", tone: "mid" as const },
  { label: "Late", tone: "warn" as const },
  { label: "Missed", tone: "risk" as const },
];
const SCHEDULE_METHOD = "Schedule compliance: on time / (on time + late + missed) for occurrences due in the period; won't-do and pending occurrences are outside the denominator.";

/** Schedule figures for a period, or why there are none: unreadable feed (unavailable) or synced and empty (no data). */
function scheduleState(cache: CacheReader): { problem: string | null; empty: boolean } {
  const problem = feedProblem(cache, "schedule_occurrences");
  return { problem, empty: !problem && cache.rows("schedule_occurrences").length === 0 };
}
const noScheduleBlocks = (s: { problem: string | null }): Block[] =>
  s.problem
    ? [unavailableBlock(`${unavailableSentence("Schedule compliance", s.problem)} This is not 0% or 100% compliance.`)]
    : [{ kind: "text", text: "No scheduling data in the cache: the schedule occurrences feed is synced and empty, so nothing was scheduled and no compliance rate is reported. This is not 0% or 100% compliance." }];

// ======================= monthly board pack =======================

export interface BoardPackArgs {
  period?: string;
  site_ids?: string[];
  /** Caller-supplied on-time target for scheduled inspections (0-100). Drawn only when given. */
  on_time_target_pct?: number;
  /** Caller-supplied tolerance for the failed-item rate (0-100). Drawn only when given. */
  failed_rate_tolerance_pct?: number;
}

const PULSE_WORDS: Record<string, { name: string; unit: "count" | "pct" }> = {
  inspections_completed: { name: "inspections", unit: "count" },
  failed_item_rate: { name: "the failed-item rate", unit: "pct" },
  average_score: { name: "the average score", unit: "pct" },
  actions_completed: { name: "completed actions", unit: "count" },
  missed_scheduled_inspections: { name: "missed scheduled inspections", unit: "count" },
};

/**
 * The opening brief: three sentences assembled only from analytics outputs already computed for the pack.
 * What changed = pulse rows with a stated direction (20+ observations both periods) and the largest league move;
 * what to watch = the last-ranked site, the highest failed-item rate with 20+ answers and the weakest rated schedule site;
 * what we need = overdue and old open actions from the backlog.
 */
function boardBrief(
  cache: CacheReader,
  rows: PulseRow[],
  lt: LeagueRow[],
  schedSites: ComplianceRow[],
  bm: Record<string, unknown>,
  topOverdue: BacklogRow | undefined,
  backlogProblem: string | null,
): Array<{ label: string; text: string }> {
  const moves: string[] = [];
  for (const key of Object.keys(PULSE_WORDS)) {
    const r = rows.find((x) => x.metric === key);
    if (!r || (r.direction !== "up" && r.direction !== "down") || r.delta === null || r.current === null) continue;
    const w = PULSE_WORDS[key]!;
    const by = w.unit === "pct" ? `${fmt(Math.abs(r.delta))} points to ${fmt(r.current)}%` : `${fmt(Math.abs(r.delta))} to ${fmt(r.current)}`;
    moves.push(`${w.name} ${r.direction === "up" ? "rose" : "fell"} ${by}`);
    if (moves.length === 2) break;
  }
  const mover = [...lt].filter((r) => r.rank_change !== null && Math.abs(r.rank_change) >= 2).sort((a, b) => Math.abs(b.rank_change!) - Math.abs(a.rank_change!) || a.rank - b.rank)[0];
  if (mover) moves.push(`${mover.site} ${mover.rank_change! > 0 ? "climbed" : "dropped"} ${plural(Math.abs(mover.rank_change!), "place")} to ${mover.rank} in the site league`);
  const sentence = (parts: string[]) => {
    const s = parts.join("; ");
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  };
  const changed = moves.length ? sentence(moves) : `No measure moved with enough observations (${MIN_N} in both periods) to call a change.`;

  // One clause per site, so a site that is both last and highest reads as one finding.
  const bySite = new Map<string, string[]>();
  const add = (site: string, clause: string) => bySite.set(site, [...(bySite.get(site) ?? []), clause]);
  const last = lt.length >= 2 ? lt[lt.length - 1] : undefined;
  if (last) add(last.site, `ranks last of ${lt.length} sites`);
  const highRate = [...lt].filter((r) => r.failed_item_rate !== null && (r.answered_items ?? 0) >= MIN_N).sort((a, b) => (b.failed_item_rate ?? 0) - (a.failed_item_rate ?? 0))[0];
  if (highRate) add(highRate.site, `has the highest failed-item rate (${highRate.failed_item_rate}%)`);
  const weakSched = schedSites.find((r) => r.resolved >= MIN_N);
  if (weakSched) add(weakSched.group, `has the lowest on-time rate (${weakSched.compliance_pct}%)`);
  const watch = [...bySite.entries()].map(([site, clauses]) => `${site} ${clauses.join(" and ")}`);
  const watchText = watch.length ? sentence(watch) : "No site has enough data this period to single out.";

  const need = backlogProblem
    ? unavailableSentence("Action figures", backlogProblem)
    : (bm.overdue as number) > 0
      ? `Owners and dates for ${plural(bm.overdue as number, "overdue action")} (overdue now)${topOverdue && topOverdue.overdue > 0 ? `, most at ${topOverdue.group} (${fmt(topOverdue.overdue)})` : ""}; ${plural(bm.age_90_plus as number, "open action")} ${bm.age_90_plus === 1 ? "is" : "are"} more than 90 days old.`
      : "No overdue actions right now; keep closing new actions on time.";
  void cache;
  return [
    { label: "What changed", text: changed },
    { label: "What to watch", text: watchText },
    { label: "What we need", text: need },
  ];
}

export function buildMonthlyBoardPack(cache: CacheReader, args: BoardPackArgs, now: Date): Built {
  const periodText = args.period ?? "last month";
  const period = parsePeriod(periodText, now, "last month");
  const siteIds = args.site_ids;
  const { pulse, tiles, attention } = pulseSections(cache, periodText, siteIds, now);
  const prev = pulse.result.previous_period;
  const prevText = rangeText(new Date(prev.from), new Date(prev.to));
  const year: Period = { from: addMonths(period.to, -12), to: period.to, label: "last 12 months" };
  const half: Period = { from: addMonths(period.to, -6), to: period.to, label: "last 6 months" };
  const monthName = period.label.startsWith("last month") || /^\d{4}-\d{2}$/.test(periodText) ? MONTH_NAMES[period.from.getUTCMonth()]! : "the period";
  const rows = pulse.result.table;
  // Pooled 12-month score from the same pulse analytic (not a mean of monthly values).
  const yearScore = metric(safetyPulse(cache, { period: rangeText(year.from, year.to), site_ids: siteIds }, now).result.table, "average_score");

  // Sites: league for this period and the pulse's previous period (same analytic, same rules).
  const league = analyzeSiteLeague(cache, { period: periodText, site_ids: siteIds }, now);
  const leaguePrev = analyzeSiteLeague(cache, { period: prevText, site_ids: siteIds }, now);
  const lt = league.result.table;
  const prevRow = new Map(leaguePrev.result.table.map((r) => [r.site_id, r]));
  const leagueOk = league.result.metrics.ranked_sites !== null;
  const rateOf = new Map(lt.map((r) => [r.site_id, r.failed_item_rate]));
  // Per-site exhibits run from the most failures to the fewest (severity), sites without a rate last.
  const siteList = [...lt.map((r) => ({ id: r.site_id, name: r.site })), ...league.result.below_minimum.map((r) => ({ id: r.site_id, name: r.site }))]
    .slice(0, 12)
    .sort((a, b) => (rateOf.get(b.id) ?? -1) - (rateOf.get(a.id) ?? -1) || a.name.localeCompare(b.name));
  const tol = args.failed_rate_tolerance_pct;
  const target = args.on_time_target_pct;

  const siteBlocks: Block[] = [];
  if (!leagueOk) siteBlocks.push(unavailableBlock(league.summary));
  else {
    const byRate = [...lt].filter((r) => r.failed_item_rate !== null).sort((a, b) => (b.failed_item_rate ?? 0) - (a.failed_item_rate ?? 0) || a.site.localeCompare(b.site));
    const ratedTop = byRate.find((r) => (r.answered_items ?? 0) >= MIN_N);
    if (lt.length)
      siteBlocks.push({
        kind: "table",
        columns: [
          { label: "Rank", align: "right" },
          { label: "Site" },
          { label: "Inspections", align: "right" },
          { label: "Average score", align: "right" },
          { label: "Failed-item rate", align: "right" },
          { label: "Overdue at period end", align: "right" },
          { label: "Rank change", align: "right" },
        ],
        rows: lt.map((r): Cell[] => [r.rank, r.site, r.inspections, pctText(r.average_score), pctText(r.failed_item_rate), r.overdue_actions, r.rank_change === null ? "new" : r.rank_change > 0 ? `+${r.rank_change}` : String(r.rank_change)]),
      });
    if (byRate.length)
      siteBlocks.push({
        kind: "dumbbell",
        title: ratedTop ? `${ratedTop.site} has the highest failed-item rate: ${ratedTop.failed_item_rate}%` : "Failed-item rate by site",
        subtitle: `Failed-item rate by ranked site, previous period (${humanDay(iso(new Date(prev.from)))} to ${humanDay(iso(new Date(new Date(prev.to).getTime() - DAY)))}) against this period`,
        fromLabel: "previous period",
        toLabel: "this period",
        unit: "%",
        good: "down",
        target: tol === undefined ? undefined : { value: tol, label: `Tolerance ${fmt(tol)}%` },
        rows: byRate.map((r) => {
          const p = prevRow.get(r.site_id);
          return { label: r.site, from: p?.failed_item_rate ?? null, to: r.failed_item_rate, muted: (r.answered_items ?? 0) < MIN_N || (p !== undefined && (p.answered_items ?? 0) < MIN_N) };
        }),
        note: `A site with no previous dot was below the minimum inspection count in the previous period.${byRate.some((r) => (r.answered_items ?? 0) < MIN_N) ? ` Gray rows: fewer than ${MIN_N} answers.` : ""}`,
      });
    if (!lt.length) siteBlocks.push({ kind: "text", text: league.summary });
    if (league.result.below_minimum.length)
      siteBlocks.push({ kind: "notes", items: [`Not ranked (below ${league.result.metrics.min_inspections} inspections): ${league.result.below_minimum.map((s) => `${s.site} (${s.inspections})`).join(", ")}.`, "Overdue at period end: open actions past due as at the end of the period (the Actions section counts them as of now)."] });
    else siteBlocks.push({ kind: "notes", items: ["Overdue at period end: open actions past due as at the end of the period (the Actions section counts them as of now)."] });
  }

  // Per-site trends: volume (small multiples, 12 months) and failed-item rate (heatmap, 6 months).
  const noInsp = feedProblem(cache, "inspections");
  const perSite: Block[] = [];
  if (noInsp) perSite.push(unavailableBlock(unavailableSentence("Per-site trends", noInsp)));
  else if (siteList.length) {
    const vol = siteList.map((s) => ({ s, t: trendSeries(cache, "inspections_completed", "month", year, [s.id], now).series }));
    const labels = vol.find((v) => v.t)?.t?.labels ?? [];
    const lastOf = (v: (typeof vol)[number]) => v.t?.values[v.t.values.length - 1] ?? null;
    const lead = [...vol].sort((a, b) => (lastOf(b) ?? -1) - (lastOf(a) ?? -1))[0];
    const bottom = lt[lt.length - 1];
    perSite.push({
      kind: "multiples",
      title: lead && lastOf(lead) !== null ? `${lead.s.name} completed the most inspections in ${monthName}: ${fmt(lastOf(lead))}` : "Inspection volume by site",
      subtitle: `Inspections completed per month by site, last 12 months, same scale in every panel, highest failed-item rate first${bottom ? `; highlighted: ${bottom.site}, last in the league` : ""}`,
      xLabels: labels,
      partial: vol.find((v) => v.t)?.t?.partial,
      panels: vol.map((v) => ({ label: v.s.name, values: v.t?.values ?? labels.map(() => null), highlight: bottom ? v.s.id === bottom.site_id : false })),
    });
    const noItems = feedProblem(cache, "inspection_items");
    if (noItems) perSite.push(unavailableBlock(unavailableSentence("Failed-item rate by site", noItems)));
    else {
      const rate = siteList.map((s) => ({ s, t: trendSeries(cache, "failed_item_rate", "month", half, [s.id], now).series }));
      const cols = rate.find((v) => v.t)?.t?.labels ?? [];
      const worst = [...lt].filter((r) => r.failed_item_rate !== null && (r.answered_items ?? 0) >= MIN_N).sort((a, b) => (b.failed_item_rate ?? 0) - (a.failed_item_rate ?? 0))[0];
      perSite.push({
        kind: "heatmap",
        title: worst ? `Failed-item rate by site and month: ${worst.site} runs highest this period` : "Failed-item rate by site and month",
        subtitle: "Failed answers as a share of answered items, by site and calendar month, last 6 months; rows from the highest rate this period (darker = more failures)",
        rowHeader: "Site",
        columns: cols,
        partial: rate.find((v) => v.t)?.t?.partial,
        unit: "%",
        good: "down",
        rows: rate.map((v) => ({ label: v.s.name, values: v.t?.values ?? cols.map(() => null) })),
      });
    }
  }

  // Actions (snapshot now).
  const b = backlogSummary(cache, periodText, siteIds, now);
  const bm = b.metrics;
  const bySite = b.unavailable ? null : overdueBySite(b, bm.overdue as number);

  // Schedules: this period against the pulse's previous period.
  const ss = scheduleState(cache);
  const sched = scheduleSummary(cache, periodText, siteIds, now);
  const schedPrev = scheduleSummary(cache, prevText, siteIds, now);
  const schedSites = analyzeScheduleCompliance(cache, { period: periodText, site_ids: siteIds, group_by: "site" }, now).result;
  const sm = sched.metrics;
  const pm = schedPrev.metrics;
  const hasSched = !ss.problem && !ss.empty && sm.due !== null;
  const enoughResolved = ((sm.resolved as number | null) ?? 0) >= MIN_N;
  const schedBlocks: Block[] = !hasSched
    ? noScheduleBlocks(ss)
    : [
        {
          kind: "bullets",
          title:
            sm.compliance_pct === null
              ? "No scheduled occurrence was resolved in the period"
              : !enoughResolved
                ? `Only ${plural(sm.resolved as number, "resolved occurrence")} this period, too few to rate`
                : `${sm.compliance_pct}% of resolved scheduled inspections were on time${pm.compliance_pct !== null ? `, against ${pm.compliance_pct}% the period before` : ""}${target !== undefined ? ` (target ${fmt(target)}%)` : ""}`,
          subtitle: `Share of ${fmt(sm.resolved as number)} resolved occurrences (on time + late + missed); marker = previous period${target !== undefined ? "; diamond = target" : ""}`,
          compareLabel: "previous period",
          rows: [
            { label: "On time", value: sm.compliance_pct as number | null, compare: pm.compliance_pct as number | null, unit: "%", max: 100, good: "up", note: `${fmt(sm.on_time as number)} of ${fmt(sm.resolved as number)}`, target },
            { label: "Late", value: sm.late_pct as number | null, compare: pm.late_pct as number | null, unit: "%", max: 100, good: "down", note: `${fmt(sm.late as number)}` },
            { label: "Missed", value: sm.missed_pct as number | null, compare: pm.missed_pct as number | null, unit: "%", max: 100, good: "down", note: `${fmt(sm.missed as number)}` },
          ],
        },
        ...[statusMix(schedSites.table, "site")].filter((x): x is Block => x !== null),
        { kind: "notes", items: sched.caveats.filter((c) => !c.startsWith("Feed ")) },
      ];

  const brief = boardBrief(cache, rows, leagueOk ? lt : [], hasSched ? schedSites.table : [], bm, b.unavailable ? undefined : b.table[0], b.unavailable ? (feedProblem(cache, "actions") ?? b.unavailable) : null);

  const summary = pulseSentences(cache, rows, pulse.result.metrics.max_days_overdue as number | null);
  if (leagueOk && lt.length >= 2) summary.push(`${lt[0]!.site} led the site league and ${lt[lt.length - 1]!.site} ranked last of ${lt.length}.`);
  if (hasSched && sm.compliance_pct !== null && enoughResolved) summary.push(`${sm.compliance_pct}% of resolved scheduled inspections were on time${pm.compliance_pct !== null ? ` (previous period ${pm.compliance_pct}%)` : ""}.`);
  if (attention[0]) summary.push(`First priority: ${attention[0].text}`);

  const report: Report = {
    title: `Monthly board pack${monthName !== "the period" ? `: ${monthName} ${period.from.getUTCFullYear()}` : ""}`,
    kind: "Board pack",
    subtitle: `${scopeText(siteIds)}. This period against the previous period of the same length.`,
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      { title: "The month in brief", blocks: [{ kind: "brief", items: brief }] },
      { title: "At a glance", intro: "Sparklines show the last 12 months.", blocks: [{ kind: "kpis", tiles: withSparks(tiles, cache, "month", year, siteIds, now, "12 months") }] },
      {
        title: "Needs attention",
        intro: "Top three by severity: overdue high-priority actions, missed scheduled inspections, failed-rate jumps, new high-priority issues.",
        blocks: [{ kind: "list", items: attention, empty: "Nothing meets the attention rules this period." }],
      },
      {
        title: "Trends",
        blocks: [
          trendChart(cache, "inspections_completed", "month", year, siteIds, now, "bar", "Inspections completed per month, last 12 months (report month highlighted)", "Inspections", { subject: "Monthly inspection volume", highlight: -1 }),
          trendChart(cache, "average_score", "month", year, siteIds, now, "line", "Average inspection score per month, last 12 months", "Average score", { subject: "The average inspection score", pooled: { value: yearScore, label: "12-month average" } }),
        ],
      },
      { title: "Sites", intro: "Ranked on inspections, average score, failed-item rate, overdue actions and resolution time. A relative ranking, not a safety rating.", blocks: [...siteBlocks, ...perSite] },
      gated(b.unavailable, {
        title: "Actions",
        intro: `As of now: ${bm.open} open, ${bm.overdue} overdue, ${bm.open_no_due_date} without a due date. Opened and closed cover the period.`,
        blocks: [
          {
            kind: "kpis",
            tiles: [
              { label: "Open actions", value: bm.open as number, note: "snapshot now" },
              { label: "Overdue now", value: bm.overdue as number, note: "snapshot now" },
              { label: "Opened in period", value: bm.opened_in_period as number, spark: b.weekly.map((w) => w.opened), sparkPartial: weekPartial(period, b.weekly), sparkLabel: "by week" },
              { label: "Closed (completed or can't do)", value: bm.closed_in_period as number, spark: b.weekly.map((w) => w.closed), sparkPartial: weekPartial(period, b.weekly), sparkLabel: "by week" },
              { label: "Median days to close", value: bm.median_resolution_days as number | null, note: `p90 ${bm.p90_resolution_days ?? "n/a"} days, over ${bm.completed_in_period} completed` },
            ],
          },
          ...(bySite ? [bySite] : []),
          ageingBlock(bm),
        ],
      }),
      { title: "Scheduled inspections", blocks: schedBlocks },
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "schedules", "sites", "templates"], now, [
        ...COMMON_METHODS,
        ...pulse.result.caveats.filter((c) => !c.startsWith("Feed ")),
        "Site league: equal-weight mean of z-scores across ranked sites (minimum inspections apply); rank change compares with the previous period.",
        `Rates and shares resting on fewer than ${MIN_N} observations are shown faded and are never used as a headline.`,
        "Closed = given a completion date in the period, including can't do; completed = status complete.",
        SCHEDULE_METHOD,
        ...(target !== undefined || tol !== undefined ? [`Targets drawn as supplied by the requester: ${[target !== undefined ? `on time ${fmt(target)}%` : "", tol !== undefined ? `failed-item rate tolerance ${fmt(tol)}%` : ""].filter(Boolean).join(", ")}.`] : []),
      ]),
    ],
  };
  return {
    report,
    summary: `Board pack for ${period.label}: ${countText(metric(rows, "inspections_completed"), "inspections")}, ${bm.open === null ? "actions unavailable" : `${bm.open} open actions (${bm.overdue} overdue)`}${hasSched ? `, ${sm.compliance_pct ?? "n/a"}% of resolved scheduled inspections on time` : ""}${leagueOk ? `, ${lt.length} sites ranked` : ""}.`,
    metrics: {
      inspections_completed: metric(rows, "inspections_completed"),
      average_score: metric(rows, "average_score"),
      failed_item_rate: metric(rows, "failed_item_rate"),
      open_actions: bm.open ?? null,
      overdue_actions: bm.overdue ?? null,
      schedule_on_time_pct: hasSched ? ((sm.compliance_pct as number | null) ?? null) : null,
      ranked_sites: leagueOk ? lt.length : null,
      score_12_months: yearScore,
    },
  };
}

// ======================= action backlog =======================

const PRIORITY_ORDER = ["high", "medium", "low", "none", "other"];

export function buildActionBacklog(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 90 days";
  const period = parsePeriod(periodText, now, "last 90 days");
  const siteIds = args.site_ids;
  const site = analyzeActionBacklog(cache, { period: periodText, site_ids: siteIds, group_by: "site" }, now);
  const pri = analyzeActionBacklog(cache, { period: periodText, site_ids: siteIds, group_by: "priority" }, now);
  const asg = analyzeActionBacklog(cache, { period: periodText, site_ids: siteIds, group_by: "assignee" }, now);
  const m = site.result.metrics;
  const unavailable = m.open === null ? site.summary : null;
  const noAssignees = feedProblem(cache, "action_assignees");
  const open = m.open as number;
  const overdue = m.overdue as number;

  const siteRows = site.result.table.filter((r) => r.open > 0).slice(0, 10);
  const priRows = [...pri.result.table].sort((a, b) => PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key));
  const high = priRows.find((r) => r.key === "high");
  const asgRows = asg.result.table.filter((r) => r.overdue > 0).slice(0, 10);
  const asgBar = (r: BacklogRow): BarRow => ({ label: r.group, value: r.overdue, note: `of ${fmt(r.open)} open`, ...(isPersonLabel(r.group) ? { group_kind: "person" as const } : {}) });
  const topAsg = asgRows[0];

  const blocksBySite: Block[] = siteRows.length
    ? [
        {
          kind: "stacked",
          title: `${siteRows[0]!.group} carries the most overdue actions: ${fmt(siteRows[0]!.overdue)} of ${fmt(siteRows[0]!.open)} open there`,
          subtitle: "Open actions by site: overdue, due later, and no due date (snapshot now), most overdue first",
          segments: [
            { label: "Overdue", tone: "risk" },
            { label: "Due later", tone: "soft" },
            { label: "No due date", tone: "pale" },
          ],
          // open = overdue + due later + no due date, as counted by the backlog analytic
          rows: siteRows.map((r) => ({ label: r.group, values: [r.overdue, r.open - r.overdue - r.no_due_date, r.no_due_date] })),
        },
      ]
    : [{ kind: "text", text: "No open actions in scope." }];

  const sections: Section[] = [
    {
      title: "Backlog at a glance",
      intro: "Open and overdue counts are a snapshot now; opened, closed and time to close cover the period.",
      blocks: [
        {
          kind: "kpis",
          tiles: [
            { label: "Open actions", value: open, note: "snapshot now" },
            { label: "Overdue now", value: overdue, note: `${m.open_no_due_date} open with no due date` },
            { label: "Older than 90 days", value: m.age_90_plus as number, note: "since creation" },
            { label: "Opened in period", value: m.opened_in_period as number, spark: site.result.weekly.map((w) => w.opened), sparkPartial: weekPartial(period, site.result.weekly), sparkLabel: "by week" },
            { label: "Closed (completed or can't do)", value: m.closed_in_period as number, note: CLOSED_NOTE, spark: site.result.weekly.map((w) => w.closed), sparkPartial: weekPartial(period, site.result.weekly), sparkLabel: "by week" },
            { label: "Median days to close", value: m.median_resolution_days as number | null, note: `p90 ${m.p90_resolution_days ?? "n/a"} days, over ${m.completed_in_period} completed` },
          ],
        },
        ageingBlock(m),
      ],
    },
    {
      title: "Closure trend",
      blocks: [
        {
          kind: "chart",
          chart: {
            kind: "line",
            title: `${fmt(m.closed_in_period as number)} actions closed (completed or can't do) against ${fmt(m.opened_in_period as number)} opened`,
            subtitle: "Actions opened and closed per week; closed = given a completion date, including can't do (weeks start Monday, UTC; the first and last weeks can be partial)",
            xLabel: "Week starting",
            yLabel: "Actions",
            seriesLabel: "closed",
            series2: { label: "opened", values: site.result.weekly.map((w) => w.opened) },
            points: site.result.weekly.map((w, i) => ({ label: w.week_start, value: w.closed, partial: weekPartial(period, site.result.weekly)[i] })),
          },
        },
      ],
    },
    { title: "Overdue by site", blocks: blocksBySite },
    {
      title: "Overdue by priority",
      blocks: priRows.length
        ? [
            {
              kind: "bars",
              title: high ? `${plural(high.overdue, "high-priority action")} ${high.overdue === 1 ? "is" : "are"} overdue` : "No high-priority actions are open",
              subtitle: "Overdue actions by priority, highest priority first",
              valueLabel: "Overdue",
              highlight: priRows.findIndex((r) => r.key === "high"),
              rows: priRows.map((r) => ({ label: capital(r.group), value: r.overdue, note: `of ${fmt(r.open)} open` })),
            },
          ]
        : [{ kind: "text", text: "No open actions in scope." }],
    },
    {
      title: "Overdue by assignee",
      intro: "Group assignees are shown as the group. An action with several assignees counts for each of them.",
      blocks: noAssignees
        ? [unavailableBlock(`${unavailableSentence("Assignee figures", noAssignees)} This does not mean the actions are unassigned.`)]
        : topAsg
          ? [
              {
                kind: "bars",
                title: isPersonLabel(topAsg.group) ? `The most loaded assignee holds ${plural(topAsg.overdue, "overdue action")}` : `${plural(topAsg.overdue, "overdue action")} have no assignee`,
                subtitle: "Overdue actions per assignee, top 10",
                valueLabel: "Overdue",
                rows: asgRows.map(asgBar),
              },
            ]
          : [{ kind: "text", text: "No overdue actions in scope." }],
    },
    {
      title: "Oldest open items",
      blocks: [
        {
          kind: "table",
          columns: [{ label: "Action" }, { label: "Site" }, { label: "Priority" }, { label: "Age (days)", align: "right" }, { label: "Due" }, { label: "Days overdue", align: "right" }],
          rows: site.result.oldest_open.map((a): Cell[] => [
            { text: String(a.title ?? "(untitled action)"), href: links.action(String(a.id)) },
            a.site === undefined ? "(no site)" : String(a.site),
            String(a.priority),
            a.age_days as number,
            a.due_date ? String(a.due_date).slice(0, 10) : "none",
            (a.overdue_days as number | null) ?? null,
          ]),
          empty: "No open actions.",
        },
      ],
    },
  ];

  const summary: string[] = unavailable
    ? [unavailable]
    : [
        `${plural(open, "action")} ${open === 1 ? "is" : "are"} open and ${fmt(overdue)} ${overdue === 1 ? "is" : "are"} overdue; ${fmt(m.age_90_plus as number)} ${m.age_90_plus === 1 ? "is" : "are"} more than 90 days old.`,
        `In the period ${fmt(m.opened_in_period as number)} ${m.opened_in_period === 1 ? "was" : "were"} opened and ${fmt(m.closed_in_period as number)} closed (completed or can't do); the ${plural(m.completed_in_period as number, "completed action")} took a median of ${m.median_resolution_days === null ? "n/a" : fmt(m.median_resolution_days as number)} days to close.`,
        ...(siteRows[0] && siteRows[0].overdue > 0 ? [`${siteRows[0].group} carries the most overdue actions (${fmt(siteRows[0].overdue)}).`] : []),
        ...(high ? [`${plural(high.overdue, "high-priority action")} ${high.overdue === 1 ? "is" : "are"} overdue.`] : []),
      ];

  const report: Report = {
    title: "Action backlog",
    kind: "Action report",
    subtitle: scopeText(siteIds),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      ...(unavailable ? [{ title: "Backlog", blocks: [unavailableBlock(unavailable)] }] : sections),
      coverageSection(cache, ["actions", "action_assignees", "sites", "users"], now, [
        "Open = status To do or In progress. Age = whole days since created; overdue = due date before now, in whole days past due.",
        "Resolution = created to completed for actions completed in the period (median and 90th percentile).",
        "Closed = given a completion date in the period, including can't do; completed = status complete, so closed can exceed completed.",
        ...site.result.caveats.filter((c) => !c.startsWith("Feed ")),
        ...asg.result.caveats.filter((c) => !c.startsWith("Feed ") && !c.startsWith("No assignee") && !c.startsWith("No action")),
      ]),
    ],
  };
  return {
    report,
    summary: unavailable ?? `Action backlog: ${open} open, ${overdue} overdue, ${m.age_90_plus} older than 90 days; ${m.opened_in_period} opened and ${m.closed_in_period} closed ${period.label}.`,
    metrics: {
      open_actions: m.open ?? null,
      overdue_actions: m.overdue ?? null,
      no_due_date: m.open_no_due_date ?? null,
      older_than_90_days: m.age_90_plus ?? null,
      median_resolution_days: m.median_resolution_days ?? null,
      opened_in_period: m.opened_in_period ?? null,
      closed_in_period: m.closed_in_period ?? null,
    },
  };
}

// ======================= schedule compliance =======================

export function buildScheduleCompliance(cache: CacheReader, args: { period?: string; site_ids?: string[]; on_time_target_pct?: number }, now: Date): Built {
  const target = args.on_time_target_pct;
  const periodText = args.period ?? "last 12 weeks";
  const period = parsePeriod(periodText, now, "last 12 weeks");
  const siteIds = args.site_ids;
  const ss = scheduleState(cache);
  const all = analyzeScheduleCompliance(cache, { period: periodText, site_ids: siteIds }, now);
  const m = all.result.metrics;
  const prevP = previousPeriod(period);
  const prev = analyzeScheduleCompliance(cache, { period: rangeText(prevP.from, prevP.to), site_ids: siteIds }, now).result.metrics;
  const bySite = analyzeScheduleCompliance(cache, { period: periodText, site_ids: siteIds, group_by: "site" }, now).result;
  const ok = !ss.problem && !ss.empty;

  let sections: Section[];
  let summary: string[];
  if (!ok) {
    sections = [{ title: "Scheduled inspections", blocks: noScheduleBlocks(ss) }];
    summary = [ss.problem ? `${unavailableSentence("Schedule compliance", ss.problem)}` : "Nothing was scheduled: the schedule occurrences feed is synced and empty."];
  } else {
    // One compliance run per calendar week (same analytic, the week as its period).
    const weeks = buckets(period, "week").map((w) => {
      const p = rangeText(new Date(w.from), new Date(w.to));
      return {
        label: w.label,
        partial: w.partial,
        all: analyzeScheduleCompliance(cache, { period: p, site_ids: siteIds }, now).result.metrics,
        sites: analyzeScheduleCompliance(cache, { period: p, site_ids: siteIds, group_by: "site" }, now).result.table,
      };
    });
    const pctOf = (x: unknown) => (x === null || x === undefined ? null : (x as number));
    // Only full weeks with MIN_N+ resolved occurrences can be singled out as the weakest.
    const ranked = weeks.filter((w) => pctOf(w.all.compliance_pct) !== null && !w.partial && ((w.all.resolved as number | null) ?? 0) >= MIN_N);
    const weakest = [...ranked].sort((a, b) => (pctOf(a.all.compliance_pct) ?? 0) - (pctOf(b.all.compliance_pct) ?? 0))[0];
    const siteRowsAll = bySite.table.filter((r) => r.resolved > 0);
    const ratedSite = siteRowsAll.find((r) => r.resolved >= MIN_N);
    const worstSched = all.result.worst;
    const ratedSched = worstSched.find((r) => r.resolved >= MIN_N);
    const enough = ((m.resolved as number | null) ?? 0) >= MIN_N;
    const tiles: Tile[] = [
      { label: "Occurrences due", value: m.due as number, note: `${fmt(m.pending as number)} still pending` },
      { label: "On time", value: m.compliance_pct as number | null, unit: "%", note: `${fmt(m.on_time as number)} of ${fmt(m.resolved as number)} resolved`, spark: weeks.map((w) => pctOf(w.all.compliance_pct)), sparkPartial: weeks.map((w) => w.partial), sparkLabel: "by week" },
      { label: "Late", value: m.late_pct as number | null, unit: "%", note: `${fmt(m.late as number)} occurrences` },
      { label: "Missed", value: m.missed_pct as number | null, unit: "%", note: `${fmt(m.missed as number)} occurrences`, spark: weeks.map((w) => pctOf(w.all.missed_pct)), sparkPartial: weeks.map((w) => w.partial), sparkLabel: "by week" },
    ];
    sections = [
      {
        title: "Compliance at a glance",
        intro: "Compliance = on time / (on time + late + missed). Pending and won't-do occurrences are outside the denominator.",
        blocks: [
          { kind: "kpis", tiles },
          {
            kind: "bullets",
            title:
              m.compliance_pct === null
                ? "No occurrence was resolved in the period"
                : !enough
                  ? `Only ${plural(m.resolved as number, "resolved occurrence")}, too few to rate`
                  : `${m.compliance_pct}% on time${prev.compliance_pct !== null && prev.compliance_pct !== undefined ? `, against ${prev.compliance_pct}% in the previous period` : ""}${target !== undefined ? ` (target ${fmt(target)}%)` : ""}`,
            subtitle: `Share of resolved occurrences; marker = previous period (${humanDay(iso(prevP.from))} to ${humanDay(iso(new Date(prevP.to.getTime() - DAY)))})${target !== undefined ? "; diamond = target" : ""}`,
            compareLabel: "previous period",
            rows: [
              { label: "On time", value: m.compliance_pct as number | null, compare: pctOf(prev.compliance_pct), unit: "%", max: 100, good: "up", target },
              { label: "Late", value: m.late_pct as number | null, compare: pctOf(prev.late_pct), unit: "%", max: 100, good: "down" },
              { label: "Missed", value: m.missed_pct as number | null, compare: pctOf(prev.missed_pct), unit: "%", max: 100, good: "down" },
            ],
          },
        ],
      },
      {
        title: "Week by week",
        blocks: [
          {
            kind: "chart",
            chart: {
              kind: "line",
              title: weakest
                ? `The week of ${humanBucket(weakest.label)} was the weakest full week: ${weakest.all.compliance_pct}% on time`
                : `On-time rate by week (no week has ${MIN_N}+ resolved occurrences, so none is singled out)`,
              subtitle: "On-time share of resolved occurrences per week (weeks start Monday, UTC); dashed line = the whole period",
              xLabel: "Week starting",
              yLabel: "On time",
              unit: "%",
              yMax: 100,
              reference: m.compliance_pct === null ? undefined : { value: m.compliance_pct as number, label: `Period ${m.compliance_pct}%` },
              target: target === undefined ? undefined : { value: target, label: `Target ${fmt(target)}%` },
              markers: weakest ? [{ index: weeks.indexOf(weakest), label: "weakest" }] : undefined,
              points: weeks.map((w) => ({ label: w.label, value: pctOf(w.all.compliance_pct), partial: w.partial })),
            },
          },
          {
            kind: "stacked",
            title: `${fmt(m.missed as number)} missed and ${fmt(m.late as number)} late out of ${fmt(m.resolved as number)} resolved occurrences`,
            subtitle: "Resolved occurrences per week by outcome",
            segments: STATUS_SEGMENTS,
            rows: weeks.map((w) => ({ label: `${shortBucket(w.label)}${w.partial ? "†" : ""}`, values: [w.all.on_time as number, w.all.late as number, w.all.missed as number] })),
            note: weeks.some((w) => w.partial) ? "† partial week: the first or last week covers fewer days." : undefined,
          },
        ],
      },
      {
        title: "Weakest schedules and sites",
        blocks: [
          ...(worstSched.length
            ? [
                {
                  kind: "bars",
                  title: ratedSched
                    ? `${ratedSched.group} is the least reliable schedule with ${MIN_N}+ resolved: ${ratedSched.compliance_pct ?? "n/a"}% on time`
                    : `No schedule has ${MIN_N} or more resolved occurrences, so none is rated`,
                  subtitle: "On-time share by schedule, lowest first (missed and resolved counts in gray)",
                  valueLabel: "On time",
                  unit: "%",
                  highlight: ratedSched ? worstSched.indexOf(ratedSched) : -1,
                  rows: worstSched.slice(0, 10).map((w) => ({ label: w.group, value: w.compliance_pct, note: `${fmt(w.missed)} missed of ${fmt(w.resolved)}`, muted: w.resolved < MIN_N })),
                  note: worstSched.slice(0, 10).some((w) => w.resolved < MIN_N) ? TOO_FEW_RESOLVED : undefined,
                } satisfies Block,
              ]
            : [{ kind: "text", text: "No resolved occurrences in this period." } satisfies Block]),
          ...[statusMix(bySite.table, "site", 12)].filter((x): x is Block => x !== null),
          {
            kind: "heatmap",
            title: ratedSite ? `On-time rate by site and week: ${ratedSite.group} is lowest over the period` : "On-time rate by site and week",
            subtitle: "On-time share of resolved occurrences, by site and week (darker = lower compliance; a dash = nothing resolved that week). A cell often rests on one or two occurrences: read it as a pattern across weeks, not a rate.",
            rowHeader: "Site",
            columns: weeks.map((w) => w.label),
            partial: weeks.map((w) => w.partial),
            unit: "%",
            good: "up",
            max: 100,
            rows: siteRowsAll.slice(0, 14).map((r) => ({ label: r.group, values: weeks.map((w) => w.sites.find((x) => x.key === r.key)?.compliance_pct ?? null) })),
            empty: "No occurrences could be tied to a site.",
          },
          { kind: "notes", items: [...all.result.caveats, ...bySite.caveats].filter((c, i, xs) => !c.startsWith("Feed ") && xs.indexOf(c) === i) },
        ],
      },
    ];
    summary = [
      m.compliance_pct === null
        ? `${plural(m.due as number, "scheduled occurrence")} fell due and none ${m.due === 1 ? "is" : "are"} resolved yet.`
        : `${fmt(m.compliance_pct as number)}% of ${plural(m.resolved as number, "resolved scheduled inspection")} ${m.resolved === 1 ? "was" : "were"} completed on time; ${fmt(m.late as number)} ${m.late === 1 ? "was" : "were"} late and ${fmt(m.missed as number)} missed.`,
      ...(prev.compliance_pct !== null && prev.compliance_pct !== undefined ? [`The previous period of the same length ran at ${prev.compliance_pct}% on time.`] : []),
      ...(ratedSched ? [`The least reliable schedule is ${ratedSched.group} (${ratedSched.compliance_pct ?? "n/a"}% on time).`] : []),
      ...(ratedSite ? [`${ratedSite.group} has the lowest on-time rate of any site with ${MIN_N}+ resolved (${ratedSite.compliance_pct ?? "n/a"}%).`] : []),
      ...(!ratedSched && !ratedSite && worstSched.length ? [`No single schedule or site has ${MIN_N} or more resolved occurrences, so none is singled out.`] : []),
    ];
  }

  const report: Report = {
    title: "Schedule compliance",
    kind: "Schedule report",
    subtitle: scopeText(siteIds),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      ...sections,
      coverageSection(cache, ["schedule_occurrences", "schedules", "schedule_assignees", "inspections", "sites"], now, [
        SCHEDULE_METHOD,
        all.result.method,
        `Rates resting on fewer than ${MIN_N} resolved occurrences are shown faded and are never used as a headline.`,
        ...(target !== undefined ? [`On-time target drawn as supplied by the requester: ${fmt(target)}%.`] : []),
      ]),
    ],
  };
  return {
    report,
    summary: ok ? all.summary : ss.problem ? unavailableSentence("Schedule compliance", ss.problem) : all.summary,
    metrics: {
      due: ok ? ((m.due as number | null) ?? null) : null,
      on_time: ok ? ((m.on_time as number | null) ?? null) : null,
      late: ok ? ((m.late as number | null) ?? null) : null,
      missed: ok ? ((m.missed as number | null) ?? null) : null,
      compliance_pct: ok ? ((m.compliance_pct as number | null) ?? null) : null,
      previous_compliance_pct: ok ? ((prev.compliance_pct as number | null) ?? null) : null,
    },
  };
}

// ======================= inspection quality =======================

export function buildInspectionQuality(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 90 days";
  const period = parsePeriod(periodText, now, "last 90 days");
  const siteIds = args.site_ids;
  const items = analyzeFailedItems(cache, { period: periodText, site_ids: siteIds, group_by: "item", top: 10 }, now);
  const byTpl = analyzeFailedItems(cache, { period: periodText, site_ids: siteIds, group_by: "template", top: 8 }, now);
  const pareto = topFailedItems(cache, periodText, siteIds, 10, now);
  const fm = items.result.metrics;
  const { result: insp, summary: inspSummary } = computeInspectorActivity(cache, { period, site_ids: siteIds, limit: 50 }, now);
  const noInsp = feedProblem(cache, "inspections");
  const noItems = feedProblem(cache, "inspection_items");

  // Template hygiene for the templates with the most failed answers (the template-quality analytic per template).
  const tq = byTpl.result.table.slice(0, 8).map((t) => ({ name: t.group, q: computeTemplateQuality(cache, { template_id: t.key, period }, now) }));
  const tqOk = !noInsp && !noItems && tq.length > 0;
  const sum = (k: "cut_candidates" | "fix") => tq.reduce((a, t) => a + ((t.q.result.metrics[k] as number | null) ?? 0), 0);
  const cut = tqOk ? sum("cut_candidates") : null;
  const fix = tqOk ? sum("fix") : null;

  const weekly: Period = { from: period.from, to: period.to, label: period.label };
  const spark = (metricName: "inspections_completed" | "failed_item_rate") => trendSeries(cache, metricName, "week", weekly, siteIds, now).series;
  const sInsp = noInsp ? null : spark("inspections_completed");
  const sRate = noInsp || noItems ? null : spark("failed_item_rate");
  const tile = (label: string, value: number | null, problem: string | null, extra: Partial<Tile> = {}): Tile =>
    problem ? { label, value: null, unit: extra.unit, note: `unavailable: ${problem}` } : { label, value, ...extra };

  const tiles: Tile[] = [
    tile("Inspections completed", (fm.inspections as number | null) ?? null, noInsp, sInsp ? { spark: sInsp.values, sparkPartial: sInsp.partial, sparkLabel: "by week" } : {}),
    tile("Failed-item rate", (fm.failure_rate_pct as number | null) ?? null, noInsp ?? noItems, { unit: "%", note: fm.failed_items === null ? undefined : `${fmt(fm.failed_items as number)} of ${fmt(fm.answered_items as number)} answers`, ...(sRate ? { spark: sRate.values, sparkPartial: sRate.partial, sparkLabel: "by week" } : {}) }),
    tile("Inspectors", (insp.metrics.inspectors as number | null) ?? null, noInsp, { note: "inspection owners" }),
    tile("Items to review", cut === null || fix === null ? null : cut + fix, noInsp ?? noItems, { note: cut === null ? undefined : `${fmt(cut)} cut, ${fmt(fix)} fix, in ${tq.length} templates` }),
  ];

  const paretoBlocks: Block[] = pareto.unavailable
    ? [unavailableBlock(pareto.unavailable)]
    : pareto.rows.length
      ? [
          {
            kind: "bars",
            title:
              pareto.rows.length >= 3 && (pareto.totalFailed ?? 0) >= MIN_N
                ? `The top 3 items carry ${pareto.rows[2]!.cumulative_share ?? "n/a"}% of all failed answers`
                : `"${pareto.rows[0]!.label}" has the most failed answers (${fmt(pareto.rows[0]!.failed)})`,
            subtitle: `Failed answers per item, largest first, with cumulative share and template (${fmt(pareto.totalFailed)} failed of ${fmt(pareto.totalAnswered)} answered)`,
            valueLabel: "Failed answers",
            rows: pareto.rows.map((r) => ({ label: r.label, value: r.failed, muted: r.answered < MIN_N, note: `${r.cumulative_share ?? "n/a"}% cum. \u00B7 ${r.answered < MIN_N ? `${fmt(r.answered)} answers, too few to rate \u00B7 ` : ""}${r.template}` })),
            note: pareto.rows.some((r) => r.answered < MIN_N) ? TOO_FEW_ANSWERS : undefined,
          },
          ...(byTpl.result.table.length
            ? [
                {
                  kind: "bars",
                  title: `${byTpl.result.table[0]!.group} accounts for ${byTpl.result.table[0]!.share_pct ?? "n/a"}% of failed answers`,
                  subtitle: "Failed answers by template, with the template's failure rate",
                  valueLabel: "Failed answers",
                  rows: byTpl.result.table.map((t) => ({
                    label: t.group,
                    value: t.failed,
                    muted: t.answered < MIN_N,
                    note: t.answered < MIN_N ? `${fmt(t.answered)} answers, too few to rate` : t.failure_rate_pct === null ? undefined : `${t.failure_rate_pct}% of ${fmt(t.answered)} answers`,
                  })),
                  note: byTpl.result.table.some((t) => t.answered < MIN_N) ? TOO_FEW_ANSWERS : undefined,
                } satisfies Block,
              ]
            : []),
        ]
      : [{ kind: "text", text: "No failed items in this period." }];

  const flagged = tq.flatMap((t) => t.q.result.table.filter((r) => r.bucket !== "keep").map((r) => ({ t: t.name, r }))).slice(0, 14);
  const hygieneBlocks: Block[] = !tqOk
    ? [noInsp || noItems ? unavailableBlock(unavailableSentence("Template quality figures", (noInsp ?? noItems)!)) : { kind: "text", text: "No templates had failed answers in this period, so none were reviewed." }]
    : [
        {
          kind: "stacked",
          title: `${plural(cut ?? 0, "item")} ${cut === 1 ? "is a candidate" : "are candidates"} to cut and ${fmt(fix)} ${fix === 1 ? "needs" : "need"} fixing across ${plural(tq.length, "template")}`,
          subtitle: "Template items (every answerable item: questions, text, dates, signatures) by verdict: cut (never fails or always N/A), fix (often skipped or N/A), keep",
          segments: [
            { label: "Cut candidate", tone: "mid" },
            { label: "Fix", tone: "warn" },
            { label: "Keep", tone: "pale" },
          ],
          rows: tq.map((t) => ({ label: t.name, values: [(t.q.result.metrics.cut_candidates as number) ?? 0, (t.q.result.metrics.fix as number) ?? 0, (t.q.result.metrics.keep as number) ?? 0] })),
        },
        {
          kind: "table",
          columns: [{ label: "Template" }, { label: "Inspections", align: "right" }, { label: "Items", align: "right" }, { label: "Cut", align: "right" }, { label: "Fix", align: "right" }, { label: "Median minutes", align: "right" }],
          rows: tq.map((t): Cell[] => {
            const q = t.q.result.metrics;
            return [t.name, q.inspections as number, q.items as number, q.cut_candidates as number, q.fix as number, q.median_duration_seconds === null ? null : round((q.median_duration_seconds as number) / 60, 1)];
          }),
        },
        {
          kind: "table",
          columns: [{ label: "Template" }, { label: "Item" }, { label: "Verdict" }, { label: "Evidence" }],
          rows: flagged.map(({ t, r }) => [t, r.label, r.bucket, r.evidence]),
          empty: "No item is flagged to cut or fix.",
        },
      ];

  const inspRows = insp.table.slice(0, 12);
  const inspectorBlocks: Block[] =
    insp.metrics.inspections === null
      ? [unavailableBlock(inspSummary)]
      : [
          ...(!noItems && inspRows.length
            ? [
                {
                  kind: "dumbbell",
                  title: `${plural(insp.metrics.inspectors as number, "inspector")} completed ${plural(insp.metrics.inspections as number, "inspection")}; each rate is set against the same-template average`,
                  subtitle: "Failed-item rate per inspector against the organisation's rate on the same templates (descriptive, not a performance score)",
                  fromLabel: "same-template average",
                  toLabel: "inspector",
                  unit: "%",
                  rows: inspRows.map((r) => ({ label: r.inspector_name, from: r.expected_rate_same_templates, to: r.failed_item_rate, group_kind: "person" as const, muted: (r.answered_items ?? 0) < MIN_N })),
                  note: inspRows.some((r) => (r.answered_items ?? 0) < MIN_N) ? `Gray rows: fewer than ${MIN_N} answered items, too few to rate.` : undefined,
                } satisfies Block,
              ]
            : []),
          {
            kind: "table",
            columns: [
              { label: "Inspector" },
              { label: "Inspections", align: "right" },
              { label: "Median minutes", align: "right" },
              { label: "Failed-item rate", align: "right" },
              { label: "Same-template average", align: "right" },
              { label: "Difference", align: "right" },
              { label: "Very fast", align: "right" },
            ],
            rows: inspRows.map((r): Cell[] => [
              { label: r.inspector_name, group_kind: "person" },
              r.inspections,
              r.median_duration_seconds === null ? null : round(r.median_duration_seconds / 60, 1),
              noItems ? "n/a" : pctText(r.failed_item_rate),
              noItems ? "n/a" : pctText(r.expected_rate_same_templates),
              noItems || r.difference_pp === null ? "n/a" : `${r.difference_pp > 0 ? "+" : ""}${r.difference_pp} pp`,
              r.very_fast_share === null ? "n/a" : `${r.very_fast_share}%`,
            ]),
            empty: "No completed inspections in the period.",
          },
          { kind: "notes", items: insp.caveats.filter((c) => !c.startsWith("Feed ")) },
        ];

  const summary: string[] = [];
  if (noInsp) summary.push(unavailableSentence("Inspection figures", noInsp));
  else {
    summary.push(`${plural(fm.inspections as number, "inspection")} ${fm.inspections === 1 ? "was" : "were"} completed by ${plural(insp.metrics.inspectors as number, "inspector")}.`);
    if (noItems) summary.push(unavailableSentence("Failed-item figures", noItems));
    else {
      summary.push(`${fmt(fm.failed_items as number)} of ${fmt(fm.answered_items as number)} answers failed (${fm.failure_rate_pct ?? "n/a"}%)${pareto.rows[0] ? `; "${pareto.rows[0].label}" failed most often (${fmt(pareto.rows[0].failed)})` : ""}.`);
      if (tqOk) summary.push(`Across the ${plural(tq.length, "template")} with the most failures, ${plural(cut ?? 0, "item")} ${cut === 1 ? "is a candidate" : "are candidates"} to cut and ${fmt(fix)} ${fix === 1 ? "needs" : "need"} fixing.`);
    }
  }

  const report: Report = {
    title: "Inspection quality",
    kind: "Quality report",
    subtitle: scopeText(siteIds),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      { title: "Quality at a glance", intro: "Sparklines show each week of the period.", blocks: [{ kind: "kpis", tiles }] },
      { title: "Failed-item Pareto", intro: "Where failures concentrate: a short list of items usually carries most of them.", blocks: paretoBlocks },
      { title: "Template hygiene", intro: "Templates with the most failed answers, reviewed item by item. Cutting dead items shortens inspections; fixing skipped ones makes answers usable.", blocks: hygieneBlocks },
      { title: "Inspector activity", intro: "Descriptive only. Volume depends on role and roster; a rate below the same-template average can mean safer areas as easily as lighter inspections.", blocks: inspectorBlocks },
      coverageSection(cache, ["inspections", "inspection_items", "templates", "users", "sites"] as FeedName[], now, [
        ...COMMON_METHODS.filter((x) => !x.startsWith("Lower issue")),
        items.result.method,
        "Template verdicts: cut = answered 200+ times and never failed, or N/A every time (10+ answers); fix = skip or N/A rate of 50% or more (10+ showings); otherwise keep.",
        "Inspector = inspection owner. Same-template average = the organisation's failed-item rate on the templates that inspector used, weighted by their answered items.",
      ]),
    ],
  };
  return {
    report,
    summary: `Inspection quality ${period.label}: ${countText(fm.inspections as number | null, "inspections")}, ${fm.failure_rate_pct === null || fm.failure_rate_pct === undefined ? "failed-item rate unavailable" : `failed-item rate ${fm.failure_rate_pct}%`}, ${countText(insp.metrics.inspectors as number | null, "inspectors")}${tqOk ? `, ${cut} items to cut and ${fix} to fix in ${tq.length} templates` : ""}.`,
    metrics: {
      inspections_completed: noInsp ? null : ((fm.inspections as number | null) ?? null),
      failed_answers: (fm.failed_items as number | null) ?? null,
      failed_item_rate: (fm.failure_rate_pct as number | null) ?? null,
      inspectors: (insp.metrics.inspectors as number | null) ?? null,
      templates_reviewed: tqOk ? tq.length : null,
      cut_candidates: cut,
      fix_items: fix,
    },
  };
}
