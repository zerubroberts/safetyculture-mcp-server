import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, type Period } from "../core/time.js";
import { coverageCaveats, coverage, feedProblem, unavailableSentence } from "../analytics/common.js";
import { round } from "../analytics/stats.js";
import { computeTrend, siteKey, type Grain, type TrendMetric } from "../analytics/trend.js";
import { computeHotspots } from "../analytics/hotspots.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import type { Block, Cell, Chart, Report, Section } from "./model.js";
import { fmt, fmtInstant } from "./model.js";
import { directionPhrase, plural, pulseSentences, trendSeries, unavailableBlock, withSparks } from "./exhibits.js";
import { backlogSummary, coverageTable, orgFingerprint, overdueActions, pulseSections, scheduleSummary, siteNameMap, topFailedItems } from "./sections.js";

/**
 * Report builders: pure functions of (cache, args, now) returning the document plus key figures.
 * Figures come from the core analytics (pulse, failed-items, backlog, schedule-compliance) and the
 * extended analytics (trend, hotspots, inspector activity).
 */

export interface BuildOptions {
  /** Applied to person names (inspectors) before they are written, e.g. pseudonyms when SC_PII=strict. */
  person?: (name: string) => string;
}

export interface Built {
  report: Report;
  summary: string;
  metrics: Record<string, number | string | null>;
}

export const stamp = (now: Date) => fmtInstant(now);
/** Order-preserving dedupe so a caveat shared by two analytics prints once. */
export const unique = (xs: string[]): string[] => [...new Set(xs)];
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v}%`);
/** "12 issues", or "issues unavailable" when the figure is withheld: never "null issues" or a made-up 0. */
export const countText = (v: number | string | null | undefined, noun: string) => (v === null || v === undefined ? `${noun} unavailable` : `${v} ${noun}`);
/** The section as built, or just its title and the reason when its figures are unavailable. */
export const gated = (unavailable: string | null, s: Section): Section => (unavailable ? { title: s.title, blocks: [unavailableBlock(unavailable)] } : s);

export interface TrendOpts {
  /** Highlight the bar at this index (others gray). */
  highlight?: number;
  /** Dashed reference line at the analytic's mean of the fitted buckets. */
  meanLine?: boolean;
  /** Short subject for the action title, e.g. "Weekly inspection volume". */
  subject?: string;
}

/** A trend chart with an action title, or an "unavailable" note when the metric's feed cannot be read (an empty chart would read as zero). */
export function trendChart(cache: CacheReader, metric: TrendMetric, grain: Grain, period: Period, siteIds: string[] | undefined, now: Date, kind: Chart["kind"], title: string, yLabel: string, opts: TrendOpts = {}): Block {
  const { series: s, problem } = trendSeries(cache, metric, grain, period, siteIds, now);
  if (!s) {
    // Same wording as before: "<title> unavailable: <reason>" or the analytic's own sentence.
    const noInsp = problem && /^the \w+ feed/.test(problem) ? problem : null;
    return unavailableBlock(noInsp ? unavailableSentence(title, noInsp) : `${title}: ${(problem ?? "").charAt(0).toLowerCase()}${(problem ?? "").slice(1)}`);
  }
  const unit = metric === "average_score" || metric === "failed_item_rate" ? "%" : "";
  const subject = opts.subject ?? title;
  const tail = s.total !== null ? `: ${plural(s.total, "inspection")} in total` : s.mean !== null ? `, averaging ${fmt(s.mean)}${unit}` : "";
  const countNoun = metric === "inspections_completed" ? tail : s.total !== null ? `: ${fmt(s.total)} in total` : tail;
  const chart: Chart = {
    kind,
    title: `${subject} ${directionPhrase(s.direction)}${countNoun}`,
    subtitle: `${title}. Trend ${s.direction}.`,
    xLabel: grain === "week" ? "Week starting" : "Month",
    yLabel,
    unit,
    // Scores sit high, so they keep the 0-100 frame (the renderer zooms it with a break marker); low rates scale to their data.
    yMax: metric === "average_score" ? 100 : undefined,
    highlight: opts.highlight !== undefined && opts.highlight < 0 ? s.labels.length + opts.highlight : opts.highlight,
    reference: opts.meanLine && s.mean !== null ? { value: s.mean, label: `Mean ${fmt(s.mean)}${unit}` } : undefined,
    points: s.labels.map((label, i) => ({ label, value: s.values[i] ?? null, partial: s.partial[i] })),
  };
  return { kind: "chart", chart };
}

export function failedItemsBlocks(cache: CacheReader, period: string, siteIds: string[] | undefined, top: number, chart: boolean, now: Date, bars = false): { blocks: Block[]; total: number | null; lead: string | null } {
  const f = topFailedItems(cache, period, siteIds, top, now);
  if (f.unavailable) return { blocks: [unavailableBlock(f.unavailable)], total: null, lead: null };
  const blocks: Block[] = [];
  const first = f.rows[0];
  const lead = first ? `"${first.label}" (${first.template}) fails most often: ${plural(first.failed, "failed answer")}, ${first.share ?? "n/a"}% of all failures` : null;
  if (chart && f.rows.length)
    blocks.push({
      kind: "chart",
      chart: {
        kind: "pareto",
        title: f.rows.length >= 3 && first ? `The top ${Math.min(3, f.rows.length)} items carry ${f.rows[Math.min(3, f.rows.length) - 1]!.cumulative_share ?? "n/a"}% of all failures` : (lead ?? "Failed items"),
        subtitle: `Failed answers by item, largest first (${f.totalFailed} failed of ${f.totalAnswered} answered). Dashed line: cumulative share.`,
        xLabel: "Item rank",
        yLabel: "Failed answers",
        points: f.rows.map((r, i) => ({ label: String(i + 1), value: r.failed })),
        cumulative: f.rows.map((r) => r.cumulative_share ?? 0),
      },
    });
  if (bars && f.rows.length)
    blocks.push({
      kind: "bars",
      title: lead ?? "Failed items",
      subtitle: `Failed answers per item, with failure rate and template; ${f.totalFailed} failed of ${f.totalAnswered} answered`,
      valueLabel: "Failed answers",
      rows: f.rows.slice(0, 8).map((r) => ({ label: r.label, value: r.failed, note: `${r.failure_rate === null ? "" : `${r.failure_rate}% · `}${r.template}` })),
    });
  blocks.push({
    kind: "table",
    columns: [
      { label: "#", align: "right" },
      { label: "Item" },
      { label: "Template" },
      { label: "Failed", align: "right" },
      { label: "Answered", align: "right" },
      { label: "Failure rate", align: "right" },
      { label: "Cumulative share", align: "right" },
      { label: "Example" },
    ],
    rows: f.rows.map((r, i) => [i + 1, r.label, r.template, r.failed, r.answered, pctText(r.failure_rate), pctText(r.cumulative_share), r.examples[0] ? { text: "Open", href: links.inspection(r.examples[0]) } : ""]),
    empty: "No failed items in this period.",
  });
  return { blocks, total: f.totalFailed, lead };
}

export function coverageSection(cache: CacheReader, feeds: FeedName[], now: Date, methods: string[]): Section {
  const cov = coverage(cache, feeds);
  const caveats = unique(coverageCaveats(cov));
  // Method bullets arrive from several analytics that share wording (e.g. the pulse repeats the
  // "Lower issue counts" line already in COMMON_METHODS); print each bullet once.
  const methodItems = unique(methods).filter((m) => !caveats.includes(m));
  return {
    title: "Data coverage",
    intro: `As of ${fmtInstant(now)}. Every figure is computed from these cached feeds; a feed that is missing or partial makes related figures missing or understated, not zero.`,
    blocks: [
      { kind: "table", columns: [{ label: "Feed" }, { label: "Rows", align: "right" }, { label: "Last synced" }, { label: "Coverage" }], rows: coverageTable(cache, feeds) },
      { kind: "notes", title: "Caveats", items: caveats },
      { kind: "notes", title: "Method", items: methodItems },
    ],
  };
}

export const COMMON_METHODS = [
  "Inspections: completed (date_completed in the period), not archived. Average score: mean score_percentage of scored inspections.",
  "Failed-item rate: failed answers / answered items, where answered = an active question or list item with a response.",
  "Changes vs the previous period are only shown when both periods have at least 20 observations.",
  "Lower issue counts can mean less reporting, not fewer hazards.",
];

export const scopeText = (siteIds?: string[]) => (siteIds?.length ? `${siteIds.length} site${siteIds.length === 1 ? "" : "s"} in scope` : "All sites");
export const metric = (rows: Array<{ metric: string; current: number | null }>, m: string) => rows.find((r) => r.metric === m)?.current ?? null;

/** Window of `n` weeks ending at `to` (sparklines and weekly charts). */
export const weeksBack = (to: Date, n: number): Period => ({ from: new Date(to.getTime() - n * 7 * 86_400_000), to, label: `last ${n} weeks` });

/** Overdue actions by site from the core backlog (grouped by site), as sorted bars. */
export function overdueBySite(b: ReturnType<typeof backlogSummary>, totalOverdue: number): Block | null {
  const rows = b.table.filter((r) => r.overdue > 0).slice(0, 8);
  if (!rows.length) return null;
  const top = rows[0]!;
  return {
    kind: "bars",
    title: `${top.group} holds the most overdue actions: ${fmt(top.overdue)} of ${fmt(totalOverdue)}`,
    subtitle: "Open actions past their due date, by site (snapshot now)",
    valueLabel: "Overdue",
    rows: rows.map((r) => ({ label: r.group, value: r.overdue, note: `of ${fmt(r.open)} open` })),
  };
}

// ---------------- weekly safety pulse ----------------

export function buildSafetyPulse(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 7 days";
  const period = parsePeriod(periodText, now, "last 7 days");
  const { pulse, tiles, attention } = pulseSections(cache, periodText, args.site_ids, now);
  const trendPeriod = weeksBack(period.to, 12);
  const failed = failedItemsBlocks(cache, periodText, args.site_ids, 10, false, now, true);
  const overdue = overdueActions(cache, args.site_ids, now);
  const backlog = backlogSummary(cache, periodText, args.site_ids, now);
  const bySite = overdue.unavailable ? null : overdueBySite(backlog, overdue.rows.length);
  const rows = pulse.result.table;
  const summary = pulseSentences(cache, rows, pulse.result.metrics.max_days_overdue as number | null);
  if (attention[0]) summary.push(`First priority: ${attention[0].text}`);
  const report: Report = {
    title: "Weekly safety pulse",
    kind: "Safety report · weekly",
    subtitle: scopeText(args.site_ids),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      {
        title: "Needs attention",
        intro: "Top three by severity: overdue high-priority actions, then missed scheduled inspections on a template, then failed-rate jumps of 10+ points, then new high-priority issues.",
        blocks: [{ kind: "list", items: attention, empty: "Nothing meets the attention rules this period." }],
      },
      { title: "Key figures", intro: "This period against the previous period of the same length. Sparklines show the last 12 weeks.", blocks: [{ kind: "kpis", tiles: withSparks(tiles, cache, "week", trendPeriod, args.site_ids, now, "12 weeks") }] },
      {
        title: "Inspections per week",
        blocks: [trendChart(cache, "inspections_completed", "week", trendPeriod, args.site_ids, now, "bar", "Inspections completed per week, last 12 weeks", "Inspections", { subject: "Weekly inspection volume" })],
      },
      { title: "Top failed items", blocks: failed.blocks },
      gated(overdue.unavailable, {
        title: "Overdue actions",
        intro: `${overdue.rows.length} open actions are past their due date.`,
        blocks: [
          ...(bySite ? [bySite] : []),
          {
            kind: "table",
            columns: [{ label: "Action" }, { label: "Site" }, { label: "Priority" }, { label: "Due" }, { label: "Days overdue", align: "right" }],
            rows: overdue.rows.slice(0, 15).map((a) => [{ text: a.title, href: links.action(a.id) }, a.site, a.priority, a.due, a.days_overdue]),
            empty: "No overdue actions.",
          },
        ],
      }),
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "sites", "templates"], now, [...COMMON_METHODS, ...pulse.result.caveats.filter((c) => !c.startsWith("Feed "))]),
    ],
  };
  return {
    report,
    summary: pulse.summary,
    metrics: {
      inspections_completed: metric(rows, "inspections_completed"),
      average_score: metric(rows, "average_score"),
      failed_item_rate: metric(rows, "failed_item_rate"),
      issues_created: metric(rows, "new_issues"),
      overdue_actions: overdue.unavailable ? null : overdue.rows.length,
      attention_items: attention.length,
    },
  };
}

// ---------------- audit evidence pack ----------------

/** Open-action ageing as a stacked bar (open by age since creation, overdue by days past due), from the core backlog metrics. */
export function ageingBlock(bm: Record<string, unknown>): Block {
  const n = (k: string) => (bm[k] as number | null) ?? 0;
  const old = n("age_90_plus");
  return {
    kind: "stacked",
    title: old ? `${plural(old, "open action")} ${old === 1 ? "is" : "are"} more than 90 days old` : "No open action is more than 90 days old",
    subtitle: "Open actions by whole days since creation; overdue actions by whole days past due (snapshot now)",
    segments: [
      { label: "0-7 days", tone: "pale" },
      { label: "8-30 days", tone: "soft" },
      { label: "31-90 days", tone: "mid" },
      { label: "Over 90 days", tone: "risk" },
    ],
    rows: [
      { label: "Open, by age", values: [n("age_0_7"), n("age_8_30"), n("age_31_90"), n("age_90_plus")] },
      { label: "Overdue, by days past due", values: [n("overdue_0_7"), n("overdue_8_30"), n("overdue_31_90"), n("overdue_90_plus")] },
    ],
  };
}

export function buildAuditPack(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 12 months";
  const period = parsePeriod(periodText, now, "last 12 months");
  const { pulse, tiles } = pulseSections(cache, periodText, args.site_ids, now);
  const failed = failedItemsBlocks(cache, periodText, args.site_ids, 15, true, now);
  const b = backlogSummary(cache, periodText, args.site_ids, now);
  const { result: hot, summary: hotSummary } = computeHotspots(cache, { period, site_ids: args.site_ids, limit: 15 }, now);
  const sched = scheduleSummary(cache, periodText, args.site_ids, now);
  const created = computeTrend(cache, { metric: "actions_created", grain: "month", period, site_ids: args.site_ids }, now).result.table;
  const completed = computeTrend(cache, { metric: "actions_completed", grain: "month", period, site_ids: args.site_ids }, now).result.table;
  const sm = sched.metrics;
  const noSched = feedProblem(cache, "schedule_occurrences");
  const hasSched = sm.due !== null && !noSched && cache.rows("schedule_occurrences").length > 0;
  const noInspRates = feedProblem(cache, "inspections");

  const worst = sched.worst;
  const schedBlocks: Block[] = noSched
    ? [unavailableBlock(`${unavailableSentence("Schedule compliance", noSched)} This is not 0% or 100% compliance.`)]
    : !hasSched
      ? [{ kind: "text", text: "No scheduling data in the cache: the schedule occurrences feed is synced and empty, so nothing was scheduled and no compliance rate is reported. This is not 0% or 100% compliance." }]
      : [
          {
            kind: "kpis",
            tiles: [
              { label: "Occurrences due", value: sm.due as number },
              { label: "Completed on time", value: sm.compliance_pct as number | null, unit: "%", note: `${sm.on_time} of ${sm.resolved} resolved` },
              { label: "Completed late", value: sm.late_pct as number | null, unit: "%", note: `${sm.late} occurrences` },
              { label: "Missed", value: sm.missed_pct as number | null, unit: "%", note: `${sm.missed} occurrences` },
            ],
          },
          ...(worst.length
            ? [
                {
                  kind: "stacked",
                  title: `${worst[0]!.group} has the lowest on-time rate: ${worst[0]!.compliance_pct ?? "n/a"}% of ${fmt(worst[0]!.resolved)} resolved`,
                  subtitle: "Resolved occurrences by outcome, lowest compliance first (bars scaled to 100% of each row)",
                  percent: true,
                  segments: [
                    { label: "On time", tone: "mid" },
                    { label: "Late", tone: "warn" },
                    { label: "Missed", tone: "risk" },
                  ],
                  rows: worst.slice(0, 8).map((w) => ({ label: w.group, values: [w.on_time, w.late, w.missed] })),
                } satisfies Block,
              ]
            : []),
          {
            kind: "table",
            columns: [{ label: "Lowest compliance" }, { label: "Resolved", align: "right" }, { label: "On time", align: "right" }, { label: "Late", align: "right" }, { label: "Missed", align: "right" }],
            rows: worst.map((w) => [w.group, w.resolved, pctText(w.compliance_pct), w.late, w.missed]),
            empty: "No resolved occurrences in this period.",
          },
          { kind: "notes", items: sched.caveats.filter((c) => !c.startsWith("Feed ")) },
        ];

  const bm = b.metrics;
  const inspections = metric(pulse.result.table, "inspections_completed");
  const cats = hot.by_category;
  const summary: string[] = [];
  summary.push(inspections === null ? unavailableSentence("Inspection figures", noInspRates ?? "the inspections feed could not be read") : `${plural(inspections, "inspection")} ${inspections === 1 ? "was" : "were"} completed in the period.`);
  if (failed.total !== null) summary.push(`${plural(failed.total, "failed answer")} ${failed.total === 1 ? "was" : "were"} recorded${failed.lead ? `; ${failed.lead}` : ""}.`);
  if (bm.open !== null) summary.push(`${plural(bm.open as number, "action")} ${bm.open === 1 ? "is" : "are"} open, ${fmt(bm.overdue as number)} overdue; median time to close was ${bm.median_resolution_days === null ? "not measurable" : `${fmt(bm.median_resolution_days as number)} days`}.`);
  if (hot.metrics.issues !== null) summary.push(`${plural(hot.metrics.issues as number, "issue")} ${hot.metrics.issues === 1 ? "was" : "were"} reported${cats[0] ? `, most often ${cats[0].category} (${fmt(cats[0].issues)})` : ""}.`);
  if (hasSched) summary.push(`${sm.compliance_pct ?? "n/a"}% of resolved scheduled inspections were on time.`);

  const report: Report = {
    title: "Audit evidence pack",
    kind: "Evidence pack",
    subtitle: scopeText(args.site_ids),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      { title: "Summary", intro: "This period against the previous period of the same length. Sparklines show each month of the period.", blocks: [{ kind: "kpis", tiles: withSparks(tiles, cache, "month", period, args.site_ids, now, "by month") }] },
      {
        title: "Inspection volume and score",
        blocks: [
          trendChart(cache, "inspections_completed", "month", period, args.site_ids, now, "bar", "Inspections completed per month", "Inspections", { subject: "Monthly inspection volume" }),
          trendChart(cache, "average_score", "month", period, args.site_ids, now, "line", "Average inspection score per month", "Average score", { subject: "The average inspection score", meanLine: true }),
        ],
      },
      { title: "Failed-item Pareto", intro: "Items ranked by failed answers; the dashed line shows the cumulative share of all failures.", blocks: failed.blocks },
      gated(b.unavailable, {
        title: "Action backlog and closure",
        blocks: [
          {
            kind: "kpis",
            tiles: [
              { label: "Open actions", value: bm.open as number, note: "snapshot now" },
              { label: "Overdue", value: bm.overdue as number, note: `${bm.open_no_due_date} open with no due date` },
              { label: "Opened in period", value: bm.opened_in_period as number },
              { label: "Closed in period", value: bm.closed_in_period as number },
              { label: "Median days to close", value: bm.median_resolution_days as number | null, note: `p90 ${bm.p90_resolution_days ?? "n/a"} days` },
            ],
          },
          ageingBlock(bm),
          {
            kind: "chart",
            chart: {
              kind: "line",
              title: `${fmt(bm.opened_in_period as number)} actions opened and ${fmt(bm.closed_in_period as number)} closed in the period`,
              subtitle: "Actions created and completed per month",
              xLabel: "Month",
              yLabel: "Actions",
              seriesLabel: "completed",
              series2: { label: "created", values: created.map((r) => r.value) },
              points: completed.map((r) => ({ label: r.bucket, value: r.value, partial: r.partial })),
            },
          },
        ],
      }),
      gated(hot.metrics.issues === null ? hotSummary : null, {
        title: "Issues by category",
        intro: `${hot.metrics.issues} issues reported in the period (previous period ${hot.metrics.previous_period_issues}).`,
        blocks: [
          ...(cats.length
            ? [
                {
                  kind: "bars",
                  title: `${cats[0]!.category} is the most reported category: ${fmt(cats[0]!.issues)} of ${fmt(hot.metrics.issues as number)} issues`,
                  subtitle: "Issues reported in the period by category (previous period in gray)",
                  valueLabel: "Issues",
                  rows: cats.slice(0, 8).map((c) => ({ label: c.category, value: c.issues, note: `prev ${fmt(c.previous)}` })),
                } satisfies Block,
              ]
            : []),
          {
            kind: "table",
            columns: [{ label: "Category" }, { label: "Issues", align: "right" }, { label: "Previous period", align: "right" }, { label: "Share", align: "right" }],
            rows: cats.map((c) => [c.category, c.issues, c.previous, pctText(c.share_pct)]),
            empty: "No issues reported in this period.",
          },
          {
            kind: "table",
            columns: [{ label: "Hotspot: category" }, { label: "Site" }, { label: "Issues", align: "right" }, { label: "Per 100 inspections", align: "right" }],
            rows: hot.table.slice(0, 10).map((r) => [r.category, r.site_name, r.issues, noInspRates ? "n/a" : r.per_100_inspections]),
            empty: "No issues reported in this period.",
          },
          { kind: "notes", items: [...(noInspRates ? [unavailableSentence("Per-100-inspection rates", noInspRates)] : []), ...hot.caveats.filter((c) => !c.startsWith("Feed "))] },
        ],
      }),
      { title: "Schedule compliance", blocks: schedBlocks },
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "sites", "templates"], now, [
        ...COMMON_METHODS,
        "Open-action ageing counts whole days since creation: 0-7, 8-30, 31-90, over 90.",
        "Schedule compliance: on time / (on time + late + missed) for occurrences due in the period; won't-do and pending occurrences are outside the denominator.",
      ]),
    ],
  };
  return {
    report,
    summary: `Audit pack for ${period.label}: ${countText(inspections, "inspections")}, ${countText(failed.total, "failed answers")}, ${bm.open === null ? "actions unavailable" : `${bm.open} open actions (${bm.overdue} overdue)`}, ${countText(hot.metrics.issues, "issues")}${hasSched ? `, ${sm.compliance_pct ?? "n/a"}% of resolved scheduled inspections on time` : ""}.`,
    metrics: {
      inspections_completed: inspections,
      failed_answers: failed.total,
      open_actions: bm.open ?? null,
      overdue_actions: bm.overdue ?? null,
      issues: hot.metrics.issues ?? null,
      schedule_on_time_pct: hasSched ? (sm.compliance_pct ?? null) : null,
    },
  };
}

// ---------------- site scorecard ----------------

export function buildSiteScorecard(cache: CacheReader, args: { site_id: string; period?: string }, now: Date, opts: BuildOptions = {}): Built {
  const periodText = args.period ?? "last 6 months";
  const period = parsePeriod(periodText, now, "last 6 months");
  const siteIds = [args.site_id];
  const siteName = siteNameMap(cache).get(siteKey(args.site_id) ?? "") ?? args.site_id;
  const person = opts.person ?? ((n: string) => n);
  const { pulse, tiles } = pulseSections(cache, periodText, siteIds, now);
  const failed = failedItemsBlocks(cache, periodText, siteIds, 10, false, now, true);
  const b = backlogSummary(cache, periodText, siteIds, now);
  const { result: hot, summary: hotSummary } = computeHotspots(cache, { period, site_ids: siteIds, limit: 10 }, now);
  const { result: insp, summary: inspSummary } = computeInspectorActivity(cache, { period, site_ids: siteIds }, now);
  const noItems = feedProblem(cache, "inspection_items");
  const bm = b.metrics;
  const rows = pulse.result.table;
  const summary = pulseSentences(cache, rows, pulse.result.metrics.max_days_overdue as number | null);
  if (hot.metrics.issues !== null) summary.push(`${plural(hot.metrics.issues as number, "issue")} ${hot.metrics.issues === 1 ? "was" : "were"} reported at the site${hot.by_category[0] ? `, most often ${hot.by_category[0].category}` : ""}.`);

  const report: Report = {
    title: `Site scorecard: ${siteName}`,
    kind: "Site scorecard",
    subtitle: "One site, this period against the previous period of the same length.",
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    summary,
    sections: [
      { title: "Key figures", intro: "Sparklines show each month of the period.", blocks: [{ kind: "kpis", tiles: withSparks(tiles, cache, "month", period, siteIds, now, "by month") }] },
      {
        title: "Trend",
        blocks: [
          trendChart(cache, "inspections_completed", "month", period, siteIds, now, "bar", "Inspections completed per month", "Inspections", { subject: "Monthly inspection volume" }),
          trendChart(cache, "failed_item_rate", "month", period, siteIds, now, "line", "Failed-item rate per month", "Failed-item rate", { subject: "The failed-item rate", meanLine: true }),
        ],
      },
      { title: "Top failed items", blocks: failed.blocks },
      gated(b.unavailable, {
        title: "Open actions",
        intro: `${bm.open} open, ${bm.overdue} overdue, ${bm.open_no_due_date} without a due date. Oldest first.`,
        blocks: [
          ageingBlock(bm),
          {
            kind: "table",
            columns: [{ label: "Action" }, { label: "Priority" }, { label: "Age (days)", align: "right" }, { label: "Due" }, { label: "Days overdue", align: "right" }],
            rows: b.oldest_open.map((a) => [
              { text: String(a.title ?? "(untitled action)"), href: String(a.link) },
              String(a.priority),
              a.age_days as number,
              a.due_date ? String(a.due_date).slice(0, 10) : "none",
              (a.overdue_days as number | null) ?? null,
            ]),
            empty: "No open actions.",
          },
        ],
      }),
      gated(hot.metrics.issues === null ? hotSummary : null, {
        title: "Issues",
        intro: `${hot.metrics.issues} issues reported in the period (previous period ${hot.metrics.previous_period_issues}).`,
        blocks: [
          ...(hot.by_category.length
            ? [
                {
                  kind: "dumbbell",
                  title: `${hot.by_category[0]!.category} leads with ${plural(hot.by_category[0]!.issues, "issue")} this period`,
                  subtitle: "Issues by category, previous period against this period. Fewer reports can mean less reporting, not fewer hazards.",
                  fromLabel: "previous period",
                  toLabel: "this period",
                  rows: hot.by_category.slice(0, 8).map((c) => ({ label: c.category, from: c.previous, to: c.issues })),
                } satisfies Block,
              ]
            : []),
          {
            kind: "table",
            columns: [{ label: "Category" }, { label: "Issues", align: "right" }, { label: "Previous period", align: "right" }],
            rows: hot.by_category.map((c) => [c.category, c.issues, c.previous]),
            empty: "No issues reported in this period.",
          },
        ],
      }),
      gated(insp.metrics.inspections === null ? inspSummary : null, {
        title: "Inspector activity",
        intro: "Descriptive only. Volume depends on role and roster; this is not a performance score.",
        blocks: [
          {
            kind: "table",
            columns: [
              { label: "Inspector" },
              { label: "Inspections", align: "right" },
              { label: "Median minutes", align: "right" },
              { label: "Failed-item rate", align: "right" },
              { label: "Same-template average", align: "right" },
            ],
            rows: insp.table.slice(0, 10).map((r): Cell[] => [
              person(r.inspector_name),
              r.inspections,
              r.median_duration_seconds === null ? null : round(r.median_duration_seconds / 60, 1),
              noItems ? "n/a" : pctText(r.failed_item_rate),
              noItems ? "n/a" : pctText(r.expected_rate_same_templates),
            ]),
            empty: "No completed inspections at this site in the period.",
          },
          { kind: "notes", items: noItems ? [unavailableSentence("Failed-item rates", noItems)] : [] },
        ],
      }),
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "sites", "users"], now, [
        ...COMMON_METHODS,
        "Inspector = inspection owner. Same-template average = the organisation's failed-item rate on the templates that inspector used, weighted by their answered items. Duration is read as seconds.",
      ]),
    ],
  };
  return {
    report,
    summary: `Scorecard for ${siteName} over ${period.label}: ${countText(metric(rows, "inspections_completed"), "inspections")}, ${metric(rows, "failed_item_rate") === null ? "failed-item rate unavailable" : `failed-item rate ${metric(rows, "failed_item_rate")}%`}, ${bm.open === null ? "actions unavailable" : `${bm.open} open actions (${bm.overdue} overdue)`}, ${countText(hot.metrics.issues, "issues")}.`,
    metrics: {
      site: siteName,
      inspections_completed: metric(rows, "inspections_completed"),
      failed_item_rate: metric(rows, "failed_item_rate"),
      open_actions: bm.open ?? null,
      overdue_actions: bm.overdue ?? null,
      issues: hot.metrics.issues ?? null,
    },
  };
}
