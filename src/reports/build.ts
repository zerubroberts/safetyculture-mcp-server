import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, type Period } from "../core/time.js";
import { coverageCaveats, coverage } from "../analytics/common.js";
import { round } from "../analytics/stats.js";
import { computeTrend, siteKey, type Grain, type TrendMetric } from "../analytics/trend.js";
import { computeHotspots } from "../analytics/hotspots.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import type { Block, Cell, Chart, Report, Section } from "./model.js";
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

const stamp = (now: Date) => `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v}%`);

function trendChart(cache: CacheReader, metric: TrendMetric, grain: Grain, period: Period, siteIds: string[] | undefined, now: Date, kind: Chart["kind"], title: string, yLabel: string): Chart {
  const t = computeTrend(cache, { metric, grain, period, site_ids: siteIds }, now).result;
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

function failedItemsBlocks(cache: CacheReader, period: string, siteIds: string[] | undefined, top: number, chart: boolean, now: Date): { blocks: Block[]; total: number } {
  const f = topFailedItems(cache, period, siteIds, top, now);
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
    rows: f.rows.map((r, i) => [i + 1, r.label, r.template, r.failed, r.answered, pctText(r.failure_rate), pctText(r.cumulative_share), r.examples[0] ? { text: "Open", href: links.inspection(r.examples[0]) } : ""]),
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
  "Failed-item rate: failed answers / answered items, where answered = an active question or list item with a response.",
  "Changes vs the previous period are only shown when both periods have at least 20 observations.",
  "Lower issue counts can mean less reporting, not fewer hazards.",
];

const scopeText = (siteIds?: string[]) => (siteIds?.length ? `${siteIds.length} site${siteIds.length === 1 ? "" : "s"} in scope` : "All sites");
const metric = (rows: Array<{ metric: string; current: number | null }>, m: string) => rows.find((r) => r.metric === m)?.current ?? null;

// ---------------- weekly safety pulse ----------------

export function buildSafetyPulse(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 7 days";
  const period = parsePeriod(periodText, now, "last 7 days");
  const { pulse, tiles, attention } = pulseSections(cache, periodText, args.site_ids, now);
  const trendPeriod: Period = { from: new Date(period.to.getTime() - 12 * 7 * 86_400_000), to: period.to, label: "last 12 weeks" };
  const failed = failedItemsBlocks(cache, periodText, args.site_ids, 10, false, now);
  const overdue = overdueActions(cache, args.site_ids, now);
  const rows = pulse.result.table;
  const report: Report = {
    title: "Weekly safety pulse",
    subtitle: scopeText(args.site_ids),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    sections: [
      {
        title: "Needs attention",
        intro: "Top three by severity: overdue high-priority actions, then missed scheduled inspections on a template, then failed-rate jumps of 10+ points, then new high-priority issues.",
        blocks: [{ kind: "list", items: attention, empty: "Nothing meets the attention rules this period." }],
      },
      { title: "Key figures", intro: "This period against the previous period of the same length.", blocks: [{ kind: "kpis", tiles }] },
      { title: "Inspections per week", blocks: [{ kind: "chart", chart: trendChart(cache, "inspections_completed", "week", trendPeriod, args.site_ids, now, "bar", "Inspections completed per week, last 12 weeks", "Inspections") }] },
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
      overdue_actions: overdue.length,
      attention_items: attention.length,
    },
  };
}

// ---------------- audit evidence pack ----------------

export function buildAuditPack(cache: CacheReader, args: { period?: string; site_ids?: string[] }, now: Date): Built {
  const periodText = args.period ?? "last 12 months";
  const period = parsePeriod(periodText, now, "last 12 months");
  const { pulse, tiles } = pulseSections(cache, periodText, args.site_ids, now);
  const failed = failedItemsBlocks(cache, periodText, args.site_ids, 15, true, now);
  const b = backlogSummary(cache, periodText, args.site_ids, now);
  const hot = computeHotspots(cache, { period, site_ids: args.site_ids, limit: 15 }, now).result;
  const sched = scheduleSummary(cache, periodText, args.site_ids, now);
  const created = computeTrend(cache, { metric: "actions_created", grain: "month", period, site_ids: args.site_ids }, now).result.table;
  const completed = computeTrend(cache, { metric: "actions_completed", grain: "month", period, site_ids: args.site_ids }, now).result.table;
  const sm = sched.metrics;
  const hasSched = sm.due !== null;

  const schedBlocks: Block[] = !hasSched
    ? [{ kind: "text", text: "No scheduling data in the cache (the schedule occurrences feed is empty), so no compliance figure is reported. This is not 0% or 100% compliance." }]
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
        {
          kind: "table",
          columns: [{ label: "Lowest compliance" }, { label: "Resolved", align: "right" }, { label: "On time", align: "right" }, { label: "Late", align: "right" }, { label: "Missed", align: "right" }],
          rows: sched.worst.map((w) => [w.group, w.resolved, pctText(w.compliance_pct), w.late, w.missed]),
          empty: "No resolved occurrences in this period.",
        },
        { kind: "notes", items: sched.caveats.filter((c) => !c.startsWith("Feed ")) },
      ];

  const bm = b.metrics;
  const report: Report = {
    title: "Audit evidence pack",
    subtitle: scopeText(args.site_ids),
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    sections: [
      { title: "Summary", intro: "This period against the previous period of the same length.", blocks: [{ kind: "kpis", tiles }] },
      {
        title: "Inspection volume and score",
        blocks: [
          { kind: "chart", chart: trendChart(cache, "inspections_completed", "month", period, args.site_ids, now, "bar", "Inspections completed per month", "Inspections") },
          { kind: "chart", chart: trendChart(cache, "average_score", "month", period, args.site_ids, now, "line", "Average inspection score per month", "Average score") },
        ],
      },
      { title: "Failed-item Pareto", intro: "Items ranked by failed answers; the dashed line shows the cumulative share of all failures.", blocks: failed.blocks },
      {
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
          {
            kind: "table",
            columns: [{ label: "Open action age (from creation)" }, { label: "Actions", align: "right" }],
            rows: [
              ["0-7 days", bm.age_0_7 as number],
              ["8-30 days", bm.age_8_30 as number],
              ["31-90 days", bm.age_31_90 as number],
              ["Over 90 days", bm.age_90_plus as number],
            ],
          },
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
            rows: hot.by_category.map((c) => [c.category, c.issues, c.previous, pctText(c.share_pct)]),
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
        "Schedule compliance: on time / (on time + late + missed) for occurrences due in the period; won't-do and pending occurrences are outside the denominator.",
      ]),
    ],
  };
  const inspections = metric(pulse.result.table, "inspections_completed");
  return {
    report,
    summary: `Audit pack for ${period.label}: ${inspections} inspections, ${failed.total} failed answers, ${bm.open} open actions (${bm.overdue} overdue), ${hot.metrics.issues} issues${hasSched ? `, ${sm.compliance_pct ?? "n/a"}% of resolved scheduled inspections on time` : ""}.`,
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
  const failed = failedItemsBlocks(cache, periodText, siteIds, 10, false, now);
  const b = backlogSummary(cache, periodText, siteIds, now);
  const hot = computeHotspots(cache, { period, site_ids: siteIds, limit: 10 }, now).result;
  const insp = computeInspectorActivity(cache, { period, site_ids: siteIds }, now).result;
  const bm = b.metrics;
  const rows = pulse.result.table;

  const report: Report = {
    title: `Site scorecard: ${siteName}`,
    subtitle: "One site, this period against the previous period of the same length.",
    fingerprint: orgFingerprint(cache),
    periodLabel: period.label,
    generatedAt: stamp(now),
    sections: [
      { title: "Key figures", blocks: [{ kind: "kpis", tiles }] },
      {
        title: "Trend",
        blocks: [
          { kind: "chart", chart: trendChart(cache, "inspections_completed", "month", period, siteIds, now, "bar", "Inspections completed per month", "Inspections") },
          { kind: "chart", chart: trendChart(cache, "failed_item_rate", "month", period, siteIds, now, "line", "Failed-item rate per month", "Failed-item rate") },
        ],
      },
      { title: "Top failed items", blocks: failed.blocks },
      {
        title: "Open actions",
        intro: `${bm.open} open, ${bm.overdue} overdue, ${bm.open_no_due_date} without a due date. Oldest first.`,
        blocks: [
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
              pctText(r.failed_item_rate),
              pctText(r.expected_rate_same_templates),
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
    summary: `Scorecard for ${siteName} over ${period.label}: ${metric(rows, "inspections_completed")} inspections, failed-item rate ${metric(rows, "failed_item_rate") ?? "n/a"}%, ${bm.open} open actions (${bm.overdue} overdue), ${hot.metrics.issues} issues.`,
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
