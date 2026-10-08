import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import type { Period } from "../core/time.js";
import { coverageCaveats, coverage } from "../analytics/common.js";
import { round } from "../analytics/stats.js";
import { computeTrend, siteKey, type Grain, type TrendMetric } from "../analytics/trend.js";
import { computeHotspots } from "../analytics/hotspots.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import type { Block, Cell, Chart, Report, Section } from "./model.js";
import {
  attentionList,
  backlogSummary,
  coverageTable,
  kpiTiles,
  orgFingerprint,
  overdueActions,
  scheduleSummary,
  siteNameMap,
  topFailedItems,
} from "./sections.js";

/** Report builders: pure functions of (cache, args, now) returning the document plus key figures. */

export interface BuildOptions {
  /** Applied to person names (inspectors) before they are written, e.g. pseudonyms when SC_PII=strict. */
  person?: (name: string) => string;
}

export interface Built {
  report: Report;
  summary: string;
  metrics: Record<string, number | string | null>;
}

const stamp = (now: Date) => `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;

function trendChart(cache: CacheReader, metric: TrendMetric, grain: Grain, period: Period, scope: { site_ids?: string[] }, now: Date, kind: Chart["kind"], title: string, yLabel: string): Chart {
  const t = computeTrend(cache, { metric, grain, period, ...scope }, now).result;
  const unit = metric === "average_score" || metric === "failed_item_rate" ? "%" : "";
  return {
    kind,
    title: `${title}: trend ${t.metrics.direction}`,
    xLabel: grain === "week" ? "Week starting" : "Month",
    yLabel,
    unit,
    yMax: unit === "%" ? 100 : undefined,
    points: t.table.map((r) => ({ label: r.bucket, value: r.value })),
  };
}

function failedItemsBlocks(cache: CacheReader, period: Period, scope: { site_ids?: string[] }, limit: number, chart: boolean): { blocks: Block[]; total: number } {
  const f = topFailedItems(cache, period, scope, limit);
  const blocks: Block[] = [];
  if (chart && f.rows.length)
    blocks.push({
      kind: "chart",
      chart: {
        kind: "pareto",
        title: `Failed items, largest first (${f.totalFailed} failed of ${f.totalAnswered} answered)`,
        xLabel: "Item rank",
        yLabel: "Failed answers",
        points: f.rows.map((r, i) => ({ label: String(i + 1), value: r.failed })),
        cumulative: f.rows.map((r) => r.cumulative_share ?? 0),
      },
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
    rows: f.rows.map((r, i) => [i + 1, r.label, r.template, r.failed, r.answered, `${r.failure_rate}%`, `${r.cumulative_share}%`, r.examples[0] ? { text: "Open", href: links.inspection(r.examples[0]) } : ""]),
    empty: "No failed items in this period.",
  });
  return { blocks, total: f.totalFailed };
}

function coverageSection(cache: CacheReader, feeds: FeedName[], now: Date, methods: string[]): Section {
  const cov = coverage(cache, feeds);
  return {
    title: "Data coverage",
    intro: `As of ${now.toISOString()}. Every figure is computed from these cached feeds; a feed that is missing or partial makes related figures missing or understated, not zero.`,
    blocks: [
      { kind: "table", columns: [{ label: "Feed" }, { label: "Rows", align: "right" }, { label: "Last synced" }, { label: "Coverage" }], rows: coverageTable(cache, feeds) },
      { kind: "notes", title: "Caveats", items: coverageCaveats(cov) },
      { kind: "notes", title: "Method", items: methods },
    ],
  };
}

const COMMON_METHODS = [
  "Inspections: completed (date_completed in the period), not archived. Average score: mean score_percentage of scored inspections.",
  "Failed-item rate: failed answers / answered items. Answered = an active, non-structural item with a non-blank response.",
  `Changes vs the previous period are only shown when both periods have at least 20 observations.`,
  "Lower issue counts can mean less reporting, not fewer hazards.",
];

// ---------------- weekly safety pulse ----------------

export function buildSafetyPulse(cache: CacheReader, args: { period: Period; site_ids?: string[] }, now: Date): Built {
  const scope = { site_ids: args.site_ids };
  const k = kpiTiles(cache, args.period, scope, now);
  const trendPeriod: Period = { from: new Date(now.getTime() - 12 * 7 * 86_400_000), to: args.period.to, label: "last 12 weeks" };
  const failed = failedItemsBlocks(cache, args.period, scope, 10, false);
  const overdue = k.overdue;
  const attention = attentionList(cache, args.period, scope, now);
  const report: Report = {
    title: "Weekly safety pulse",
    subtitle: args.site_ids?.length ? `${args.site_ids.length} site${args.site_ids.length === 1 ? "" : "s"} in scope` : "All sites",
    fingerprint: orgFingerprint(cache),
    periodLabel: args.period.label,
    generatedAt: stamp(now),
    sections: [
      { title: "Needs attention", intro: "Ordered by severity: overdue high-priority actions, missed scheduled inspections, failed-rate jumps of 10+ points, new high-priority issues.", blocks: [{ kind: "list", items: attention, empty: "Nothing meets the attention rules this period." }] },
      { title: "Key figures", intro: "This period against the previous period of the same length.", blocks: [{ kind: "kpis", tiles: k.tiles }] },
      { title: "Inspections per week", blocks: [{ kind: "chart", chart: trendChart(cache, "inspections_completed", "week", trendPeriod, scope, now, "bar", "Inspections completed per week, last 12 weeks", "Inspections") }] },
      { title: "Top failed items", blocks: failed.blocks },
      {
        title: "Overdue actions",
        intro: `${overdue.length} open actions are past their due date.`,
        blocks: [
          {
            kind: "table",
            columns: [{ label: "Action" }, { label: "Site" }, { label: "Priority" }, { label: "Due" }, { label: "Days overdue", align: "right" }],
            rows: overdue.slice(0, 15).map((a) => [{ text: a.title, href: links.action(a.id) }, a.site, a.priority, a.due, a.days_overdue]),
            empty: "No overdue actions.",
          },
        ],
      },
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "sites", "templates"], now, COMMON_METHODS),
    ],
  };
  const v = (label: string) => k.raw.find((t) => t.label === label)?.value ?? null;
  return {
    report,
    summary: `Safety pulse for ${args.period.label}: ${v("Inspections completed")} inspections, failed-item rate ${v("Failed-item rate") ?? "n/a"}%, ${overdue.length} overdue actions, ${attention.length} attention items.`,
    metrics: {
      inspections_completed: v("Inspections completed"),
      average_score: v("Average score"),
      failed_item_rate: v("Failed-item rate"),
      issues_created: v("Issues reported"),
      overdue_actions: overdue.length,
      attention_items: attention.length,
    },
  };
}

// ---------------- audit evidence pack ----------------

export function buildAuditPack(cache: CacheReader, args: { period: Period; site_ids?: string[] }, now: Date): Built {
  const scope = { site_ids: args.site_ids };
  const k = kpiTiles(cache, args.period, scope, now);
  const failed = failedItemsBlocks(cache, args.period, scope, 15, true);
  const b = backlogSummary(cache, args.period, scope, now);
  const hot = computeHotspots(cache, { period: args.period, site_ids: args.site_ids, limit: 15 }, now).result;
  const sched = args.site_ids?.length ? undefined : scheduleSummary(cache, args.period);
  const created = computeTrend(cache, { metric: "actions_created", grain: "month", period: args.period, ...scope }, now).result.table;
  const completed = computeTrend(cache, { metric: "actions_completed", grain: "month", period: args.period, ...scope }, now).result.table;

  const schedBlocks: Block[] =
    sched === undefined
      ? [{ kind: "text", text: "Schedule occurrences carry no site, so compliance is only reported for the whole organisation (run this pack without a site scope)." }]
      : sched === null
        ? [{ kind: "text", text: "No scheduling data in the cache (the schedule occurrences feed is empty), so no compliance figure is reported." }]
        : [
            {
              kind: "kpis",
              tiles: [
                { label: "Occurrences due", value: sched.due },
                { label: "Completed on time", value: sched.on_time_pct, unit: "%", note: `${sched.counts.COMPLETED} of ${sched.counts.COMPLETED! + sched.counts.LATE! + sched.counts.MISSED!} resolved` },
                { label: "Completed late", value: sched.late_pct, unit: "%", note: `${sched.counts.LATE} occurrences` },
                { label: "Missed", value: sched.missed_pct, unit: "%", note: `${sched.counts.MISSED} occurrences` },
              ],
            },
            { kind: "table", columns: [{ label: "Status" }, { label: "Occurrences", align: "right" }], rows: Object.entries(sched.counts).map(([s, n]) => [s.toLowerCase().replace(/_/g, " "), n]) },
          ];

  const report: Report = {
    title: "Audit evidence pack",
    subtitle: args.site_ids?.length ? `${args.site_ids.length} site${args.site_ids.length === 1 ? "" : "s"} in scope` : "All sites",
    fingerprint: orgFingerprint(cache),
    periodLabel: args.period.label,
    generatedAt: stamp(now),
    sections: [
      { title: "Summary", intro: "This period against the previous period of the same length.", blocks: [{ kind: "kpis", tiles: k.tiles }] },
      {
        title: "Inspection volume and score",
        blocks: [
          { kind: "chart", chart: trendChart(cache, "inspections_completed", "month", args.period, scope, now, "bar", "Inspections completed per month", "Inspections") },
          { kind: "chart", chart: trendChart(cache, "average_score", "month", args.period, scope, now, "line", "Average inspection score per month", "Average score") },
        ],
      },
      { title: "Failed-item Pareto", intro: "Items ranked by failed answers; the line shows how much of all failures the top items account for.", blocks: failed.blocks },
      {
        title: "Action backlog and closure",
        blocks: [
          {
            kind: "kpis",
            tiles: [
              { label: "Open actions", value: b.open, note: "snapshot now" },
              { label: "Overdue", value: b.overdue, note: `${b.no_due_date} open with no due date` },
              { label: "Created in period", value: b.created_in_period },
              { label: "Completed in period", value: b.completed_in_period },
              { label: "Median days to close", value: b.median_resolution_days, note: "actions completed in the period" },
            ],
          },
          { kind: "table", columns: [{ label: "Open action age (from creation)" }, { label: "Actions", align: "right" }], rows: Object.entries(b.ageing).map(([k2, n]) => [k2, n]) },
          {
            kind: "table",
            columns: [{ label: "Month" }, { label: "Created", align: "right" }, { label: "Completed", align: "right" }],
            rows: created.map((r, i) => [r.bucket, r.value, completed[i]?.value ?? null]),
          },
        ],
      },
      {
        title: "Issues by category",
        intro: `${hot.metrics.issues} issues reported in the period (previous period ${hot.metrics.previous_period_issues}).`,
        blocks: [
          {
            kind: "table",
            columns: [{ label: "Category" }, { label: "Issues", align: "right" }, { label: "Previous period", align: "right" }, { label: "Share", align: "right" }],
            rows: hot.by_category.map((c) => [c.category, c.issues, c.previous, c.share_pct === null ? null : `${c.share_pct}%`]),
            empty: "No issues reported in this period.",
          },
          {
            kind: "table",
            columns: [{ label: "Hotspot: category" }, { label: "Site" }, { label: "Issues", align: "right" }, { label: "Per 100 inspections", align: "right" }],
            rows: hot.table.slice(0, 10).map((r) => [r.category, r.site_name, r.issues, r.per_100_inspections]),
            empty: "No issues reported in this period.",
          },
          { kind: "notes", items: hot.caveats.filter((c) => !c.startsWith("Feed ")) },
        ],
      },
      { title: "Schedule compliance", blocks: schedBlocks },
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "sites", "templates"], now, [
        ...COMMON_METHODS,
        "Open-action ageing counts whole days since creation: 0-7, 8-30, 31-90, over 90.",
        "Schedule compliance: on time = COMPLETED / (COMPLETED + LATE + MISSED) for occurrences due in the period; won't-do and pending occurrences are excluded from the denominator.",
      ]),
    ],
  };
  return {
    report,
    summary: `Audit pack for ${args.period.label}: ${k.raw[0]!.value} inspections, ${failed.total} failed answers, ${b.open} open actions (${b.overdue} overdue), ${hot.metrics.issues} issues${sched ? `, ${sched.on_time_pct ?? "n/a"}% of scheduled inspections on time` : ""}.`,
    metrics: {
      inspections_completed: k.raw[0]!.value,
      failed_answers: failed.total,
      open_actions: b.open,
      overdue_actions: b.overdue,
      issues: hot.metrics.issues ?? null,
      schedule_on_time_pct: sched ? sched.on_time_pct : null,
    },
  };
}

// ---------------- site scorecard ----------------

export function buildSiteScorecard(cache: CacheReader, args: { site_id: string; period: Period }, now: Date, opts: BuildOptions = {}): Built {
  const scope = { site_ids: [args.site_id] };
  const siteName = siteNameMap(cache).get(siteKey(args.site_id) ?? "") ?? args.site_id;
  const person = opts.person ?? ((n: string) => n);
  const k = kpiTiles(cache, args.period, scope, now);
  const failed = failedItemsBlocks(cache, args.period, scope, 10, false);
  const b = backlogSummary(cache, args.period, scope, now);
  const hot = computeHotspots(cache, { period: args.period, site_ids: scope.site_ids, limit: 10 }, now).result;
  const insp = computeInspectorActivity(cache, { period: args.period, site_ids: scope.site_ids }, now).result;
  const overdue = overdueActions(cache, scope, now);

  const report: Report = {
    title: `Site scorecard: ${siteName}`,
    subtitle: "One site, this period against the previous period of the same length.",
    fingerprint: orgFingerprint(cache),
    periodLabel: args.period.label,
    generatedAt: stamp(now),
    sections: [
      { title: "Key figures", blocks: [{ kind: "kpis", tiles: k.tiles }] },
      {
        title: "Trend",
        blocks: [
          { kind: "chart", chart: trendChart(cache, "inspections_completed", "month", args.period, scope, now, "bar", "Inspections completed per month", "Inspections") },
          { kind: "chart", chart: trendChart(cache, "failed_item_rate", "month", args.period, scope, now, "line", "Failed-item rate per month", "Failed-item rate") },
        ],
      },
      { title: "Top failed items", blocks: failed.blocks },
      {
        title: "Open actions",
        intro: `${b.open} open, ${b.overdue} overdue, ${b.no_due_date} without a due date.`,
        blocks: [
          {
            kind: "table",
            columns: [{ label: "Action" }, { label: "Priority" }, { label: "Age (days)", align: "right" }, { label: "Due" }, { label: "Days overdue", align: "right" }],
            rows: b.openRows.slice(0, 15).map((a) => [{ text: a.title, href: links.action(a.id) }, a.priority, a.age_days, a.due ?? "none", a.days_overdue]),
            empty: "No open actions.",
          },
        ],
      },
      {
        title: "Issues",
        intro: `${hot.metrics.issues} issues reported in the period (previous period ${hot.metrics.previous_period_issues}).`,
        blocks: [
          {
            kind: "table",
            columns: [{ label: "Category" }, { label: "Issues", align: "right" }, { label: "Previous period", align: "right" }],
            rows: hot.by_category.map((c) => [c.category, c.issues, c.previous]),
            empty: "No issues reported in this period.",
          },
        ],
      },
      {
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
              r.failed_item_rate === null ? null : `${r.failed_item_rate}%`,
              r.expected_rate_same_templates === null ? null : `${r.expected_rate_same_templates}%`,
            ]),
            empty: "No completed inspections at this site in the period.",
          },
        ],
      },
      coverageSection(cache, ["inspections", "inspection_items", "actions", "issues", "sites", "users"], now, [
        ...COMMON_METHODS,
        "Inspector = inspection owner. Same-template average = the organisation's failed-item rate on the templates that inspector used, weighted by their answered items. Duration is read as seconds.",
      ]),
    ],
  };
  return {
    report,
    summary: `Scorecard for ${siteName} over ${args.period.label}: ${k.raw[0]!.value} inspections, failed-item rate ${k.raw[2]!.value ?? "n/a"}%, ${b.open} open actions (${overdue.length} overdue), ${hot.metrics.issues} issues.`,
    metrics: {
      site: siteName,
      inspections_completed: k.raw[0]!.value,
      failed_item_rate: k.raw[2]!.value,
      open_actions: b.open,
      overdue_actions: overdue.length,
      issues: hot.metrics.issues ?? null,
    },
  };
}
