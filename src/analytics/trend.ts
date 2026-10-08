import type { CacheReader } from "../cache/contract.js";
import { addMonths, type Period } from "../core/time.js";
import { bool, buildResult, num, str } from "./common.js";
import { FAILABLE_TYPES, canon, isAnswered as coreIsAnswered, isFailed as coreIsFailed, normLabel as coreNormLabel } from "./failed-items.js";
import { isResolved, normPriority, normStatus, toAction } from "./backlog.js";
import { mean, pct, round } from "./stats.js";

/**
 * Inspection trend over time, plus the row-normalisation helpers shared by the extended analytics
 * (template quality, inspector activity, anomalies, stalls, hotspots) and the reports.
 *
 * Definitions are delegated to the core analytics so numbers match the core tools exactly:
 * ID matching = canon() and answered / failed items = isAnswered() / isFailed() from failed-items.ts;
 * action status, priority, open and resolved = normStatus / normPriority / toAction / isResolved from backlog.ts.
 *
 * Field names relied on (confirmed with scripts/api-ref.mjs and docs/api-shapes.md):
 *   inspections: id, archived, owner_id, owner_name, score_percentage, max_score, duration, site_id,
 *                template_id, template_name, date_started, date_completed, name
 *   inspection_items: audit_id, item_id, parent_id, type, label, response, is_failed_response,
 *                inactive, category, primeelement_id
 *   issues: created_at, site_id, template_id
 *   actions: created_at, completed_at, site_id, template_id, status, priority
 */

export const DAY_MS = 86_400_000;
export { FAILABLE_TYPES };

// ---------- key normalisation: the core canon() (prefix-free, dash-free, lower case) ----------

const keyOf = (v: unknown): string | undefined => {
  const s = str(v)?.trim();
  return s ? canon(s) : undefined;
};
export const auditKey = keyOf;
export const templateKey = keyOf;
export const userKey = keyOf;
export const siteKey = keyOf;
export const uuidKey = keyOf;

export const toTime = (v: unknown): number | undefined => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};
export const inWindow = (t: number | undefined, from: number, to: number) => t !== undefined && t >= from && t < to;
/** Minimum without spreading (safe for very large arrays). */
export const minOf = (xs: number[]): number | undefined => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : undefined);
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface ScopeFilter {
  site_ids?: string[];
  template_ids?: string[];
}
const keySet = (vals?: string[]) => (vals?.length ? new Set(vals.map(keyOf).filter((v): v is string => Boolean(v))) : undefined);
export const siteSet = keySet;
export const templateSet = keySet;

// ---------- inspections ----------

export interface Insp {
  id: string;
  key: string;
  name?: string;
  templateKey?: string;
  templateId?: string;
  templateName?: string;
  siteKey?: string;
  siteId?: string;
  ownerKey?: string;
  ownerId?: string;
  ownerName?: string;
  startedAt?: number;
  completedAt: number;
  /** Feed `duration`, only when > 0 (zero/missing durations are treated as unknown). */
  duration?: number;
  /** score_percentage when the inspection is scored (max_score > 0). */
  scorePct?: number;
}

export function toInsp(r: Record<string, unknown>): Insp | undefined {
  const completedAt = toTime(r.date_completed);
  const key = auditKey(r.id);
  if (completedAt === undefined || !key || bool(r.archived)) return undefined;
  const dur = num(r.duration);
  const maxScore = num(r.max_score);
  const sp = num(r.score_percentage);
  return {
    id: String(r.id),
    key,
    name: str(r.name),
    templateKey: templateKey(r.template_id),
    templateId: str(r.template_id),
    templateName: str(r.template_name),
    siteKey: siteKey(r.site_id),
    siteId: str(r.site_id),
    ownerKey: userKey(r.owner_id),
    ownerId: str(r.owner_id),
    ownerName: str(r.owner_name),
    startedAt: toTime(r.date_started),
    completedAt,
    duration: dur !== undefined && dur > 0 ? dur : undefined,
    scorePct: maxScore !== undefined && maxScore > 0 && sp !== undefined ? sp : undefined,
  };
}

/** Completed, non-archived inspections (same rule as the core completedInspections), optionally windowed and scoped. */
export function completedInspections(cache: CacheReader, window?: { from: number; to: number }, scope: ScopeFilter = {}): Insp[] {
  const sites = siteSet(scope.site_ids);
  const tpls = templateSet(scope.template_ids);
  const out: Insp[] = [];
  for (const r of cache.rows("inspections")) {
    const i = toInsp(r);
    if (!i) continue;
    if (window && !inWindow(i.completedAt, window.from, window.to)) continue;
    if (sites && !(i.siteKey && sites.has(i.siteKey))) continue;
    if (tpls && !(i.templateKey && tpls.has(i.templateKey))) continue;
    out.push(i);
  }
  return out;
}

// ---------- inspection items ----------

/** Item types that are containers or static content, never answered (used for presence / skip analysis only). */
export const STRUCTURAL_TYPES = new Set(["section", "category", "information", "smartfield", "dynamicfield", "primeelement"]);
export const FREE_TEXT_TYPES = new Set(["text", "textsingle"]);
export const CONDITIONAL_PARENT_TYPES = new Set(["smartfield", "dynamicfield"]);

export interface Item {
  raw: Record<string, unknown>;
  auditKey: string;
  itemId?: string;
  parentId?: string;
  type: string;
  label: string;
  labelKey: string;
  category?: string;
  response: string;
  inactive: boolean;
  repeated: boolean;
}

export const normLabel = (s: string) => coreNormLabel(s);

export function toItem(r: Record<string, unknown>): Item | undefined {
  const a = auditKey(r.audit_id);
  if (!a) return undefined;
  const label = str(r.label) ?? "";
  return {
    raw: r,
    auditKey: a,
    itemId: str(r.item_id),
    parentId: str(r.parent_id),
    type: (str(r.type) ?? "").toLowerCase(),
    label,
    labelKey: normLabel(label),
    category: str(r.category),
    response: str(r.response) ?? "",
    inactive: bool(r.inactive),
    repeated: Boolean(str(r.primeelement_id)),
  };
}

/** Shown to the inspector and capable of holding an answer (any type). */
export const isPresented = (i: Item) => !i.inactive && !STRUCTURAL_TYPES.has(i.type);
/** Presented and has a non-blank response, any item type (template hygiene only). */
export const hasResponse = (i: Item) => isPresented(i) && i.response.trim() !== "";
/** Core definition: active pass/fail-capable item (question, list) with a response. The failed-item rate denominator. */
export const isAnswered = (i: Item) => coreIsAnswered(i.raw);
/** Core definition: answered and flagged is_failed_response. */
export const isFailed = (i: Item) => coreIsFailed(i.raw);
const NA = new Set(["n/a", "na", "not applicable"]);
export const isNA = (i: Item) => hasResponse(i) && NA.has(i.response.trim().toLowerCase());

/** Items grouped by normalised inspection key, only for the given inspections. */
export function itemsByInspection(cache: CacheReader, inspKeys: Set<string>): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const r of cache.rows("inspection_items")) {
    const it = toItem(r);
    if (!it || !inspKeys.has(it.auditKey)) continue;
    const arr = out.get(it.auditKey);
    if (arr) arr.push(it);
    else out.set(it.auditKey, [it]);
  }
  return out;
}

/** Answered and failed item counts per inspection (core definitions). */
export function itemCounts(items: Map<string, Item[]>): Map<string, { answered: number; failed: number }> {
  const out = new Map<string, { answered: number; failed: number }>();
  for (const [k, arr] of items) {
    let answered = 0;
    let failed = 0;
    for (const i of arr) {
      if (isAnswered(i)) answered++;
      if (isFailed(i)) failed++;
    }
    out.set(k, { answered, failed });
  }
  return out;
}

// ---------- actions and issues (core normStatus / normPriority / toAction) ----------

/** Friendly status: to_do, in_progress, complete, cant_do or unknown (core normStatus). */
export const actionStatus = (v: unknown): string => normStatus(v);
/** high, medium, low, none or other (core normPriority). */
export const actionPriority = (v: unknown): string => normPriority(v);
export const CLOSED_STATUSES = new Set(["complete", "cant_do"]);
/** Core rule: status decides; an unrecognised status is open only when there is no completion date. */
export const isOpenAction = (r: Record<string, unknown>) => toAction(r).open;
/** Core rule for "completed" counts: completion date and status complete (or unrecognised). */
export const isResolvedAction = (r: Record<string, unknown>) => isResolved(toAction(r));

export function inScope(r: Record<string, unknown>, sites?: Set<string>, tpls?: Set<string>): boolean {
  if (sites) {
    const s = siteKey(r.site_id);
    if (!s || !sites.has(s)) return false;
  }
  if (tpls) {
    const t = templateKey(r.template_id);
    if (!t || !tpls.has(t)) return false;
  }
  return true;
}

// ---------- buckets ----------

export type Grain = "week" | "month";
export interface Bucket {
  label: string;
  from: number;
  to: number;
  /** True when the bucket is cut short by the period edges. */
  partial: boolean;
}

/** Calendar buckets (ISO weeks starting Monday, or calendar months, UTC) clipped to the period. */
export function buckets(p: Period, grain: Grain): Bucket[] {
  const from = p.from.getTime();
  const to = p.to.getTime();
  const out: Bucket[] = [];
  const d = new Date(from);
  let start: number;
  if (grain === "week") {
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const dow = (new Date(day).getUTCDay() + 6) % 7;
    start = day - dow * DAY_MS;
  } else {
    start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  while (start < to) {
    const s = new Date(start);
    const end = grain === "week" ? start + 7 * DAY_MS : Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1);
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    out.push({
      label: grain === "week" ? isoDay(start) : s.toISOString().slice(0, 7),
      from: a,
      to: b,
      partial: a !== start || b !== end,
    });
    start = end;
  }
  return out;
}

/** The same bucket one year earlier: 52 weeks back for weeks (keeps the weekday), same month for months. */
export function lastYear(b: Bucket, grain: Grain): { from: number; to: number } {
  if (grain === "week") return { from: b.from - 364 * DAY_MS, to: b.to - 364 * DAY_MS };
  // Clamped calendar shift: a leap day maps to Feb 28, never overflowing into March.
  const shift = (t: number) => addMonths(new Date(t), -12).getTime();
  return { from: shift(b.from), to: shift(b.to) };
}

/** Ordinary least-squares slope of y on x. */
export function olsSlope(points: Array<[number, number]>): number {
  const n = points.length;
  if (n < 2) return NaN;
  const mx = mean(points.map((p) => p[0]));
  const my = mean(points.map((p) => p[1]));
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

// ---------- the trend analytic ----------

export const TREND_METRICS = ["inspections_completed", "average_score", "failed_item_rate", "issues_created", "actions_created", "actions_completed"] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];
const COUNT_METRICS = new Set<TrendMetric>(["inspections_completed", "issues_created", "actions_created", "actions_completed"]);
export const MIN_TREND_BUCKETS = 6;

export interface TrendArgs extends ScopeFilter {
  metric: TrendMetric;
  grain: Grain;
  period: Period;
}

export interface TrendRow {
  bucket: string;
  from: string;
  to: string;
  partial: boolean;
  value: number | null;
  n: number;
  last_year_value: number | null;
  last_year_n: number | null;
}

/** Computes one metric for any window; `n` is the number of observations behind the value. */
export function measurer(cache: CacheReader, metric: TrendMetric, scope: ScopeFilter) {
  const sites = siteSet(scope.site_ids);
  const tpls = templateSet(scope.template_ids);
  if (metric === "inspections_completed" || metric === "average_score" || metric === "failed_item_rate") {
    const insps = completedInspections(cache, undefined, scope);
    const counts = metric === "failed_item_rate" ? itemCounts(itemsByInspection(cache, new Set(insps.map((i) => i.key)))) : undefined;
    const earliest = minOf(insps.map((i) => i.completedAt));
    return {
      earliest,
      measure(from: number, to: number) {
        const w = insps.filter((i) => inWindow(i.completedAt, from, to));
        if (metric === "inspections_completed") return { value: w.length, n: w.length };
        if (metric === "average_score") {
          const s = w.map((i) => i.scorePct).filter((x): x is number => x !== undefined);
          return { value: s.length ? round(mean(s), 1) : null, n: s.length };
        }
        let answered = 0;
        let failed = 0;
        for (const i of w) {
          const c = counts!.get(i.key);
          if (c) {
            answered += c.answered;
            failed += c.failed;
          }
        }
        return { value: pct(failed, answered, 1), n: answered };
      },
    };
  }
  const feed = metric === "issues_created" ? "issues" : "actions";
  const dateField = metric === "actions_completed" ? "completed_at" : "created_at";
  const rows = cache.rows(feed).filter((r) => inScope(r, sites, tpls) && (metric !== "actions_completed" || isResolvedAction(r)));
  const times = rows.map((r) => toTime(r[dateField])).filter((t): t is number => t !== undefined);
  const allCreated = cache.rows(feed).map((r) => toTime(r.created_at)).filter((t): t is number => t !== undefined);
  return {
    earliest: minOf(allCreated),
    measure(from: number, to: number) {
      const n = times.filter((t) => inWindow(t, from, to)).length;
      return { value: n, n };
    },
  };
}

export function computeTrend(cache: CacheReader, args: TrendArgs, now: Date) {
  const { metric, grain, period } = args;
  const scope = { site_ids: args.site_ids, template_ids: args.template_ids };
  const m = measurer(cache, metric, scope);
  const bs = buckets(period, grain);
  const table: TrendRow[] = bs.map((b) => {
    const cur = m.measure(b.from, b.to);
    const ly = lastYear(b, grain);
    // Last year is only "available" when the feed holds records at least that old.
    const available = m.earliest !== undefined && m.earliest <= ly.from;
    const prev = available ? m.measure(ly.from, ly.to) : undefined;
    const lyValue = prev ? (COUNT_METRICS.has(metric) || prev.n > 0 ? prev.value : null) : null;
    return {
      bucket: b.label,
      from: new Date(b.from).toISOString(),
      to: new Date(b.to).toISOString(),
      partial: b.partial,
      value: cur.value,
      n: cur.n,
      last_year_value: lyValue,
      last_year_n: prev ? prev.n : null,
    };
  });

  // Counts in partial buckets cover fewer days, so they are left out of the slope; rates are not.
  const fitted = table
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.value !== null && (!COUNT_METRICS.has(metric) || !r.partial) && (COUNT_METRICS.has(metric) || r.n > 0));
  const slope = fitted.length >= 2 ? olsSlope(fitted.map(({ r, i }) => [i, r.value as number])) : NaN;
  const avg = fitted.length ? mean(fitted.map(({ r }) => r.value as number)) : NaN;
  let direction: string;
  if (fitted.length < MIN_TREND_BUCKETS) direction = `not stated (only ${fitted.length} usable ${grain}s; needs ${MIN_TREND_BUCKETS})`;
  else {
    const change = slope * (fitted[fitted.length - 1]!.i - fitted[0]!.i);
    direction = Math.abs(change) < 0.05 * Math.abs(avg) || change === 0 ? "flat" : change > 0 ? "rising" : "falling";
  }
  const values = table.filter((r) => r.value !== null).map((r) => r.value as number);
  const total = COUNT_METRICS.has(metric) ? values.reduce((a, b) => a + b, 0) : null;
  const unit = metric === "average_score" || metric === "failed_item_rate" ? "%" : "";

  const caveats: string[] = [];
  if (table.some((r) => r.partial)) caveats.push(`The first and/or last ${grain} only partly overlaps the period; counts there cover fewer days and are excluded from the slope.`);
  if (table.every((r) => r.last_year_value === null)) caveats.push("No same-period-last-year comparison: the cached data does not go back that far.");
  if (metric === "issues_created") caveats.push("Lower issue counts can mean less reporting, not fewer hazards.");
  if (metric === "failed_item_rate") caveats.push("Failed-item rate counts every answered item equally, whatever its importance.");

  const feeds =
    metric === "issues_created" ? (["issues"] as const) : metric.startsWith("actions") ? (["actions"] as const) : metric === "failed_item_rate" ? (["inspections", "inspection_items"] as const) : (["inspections"] as const);
  const result = buildResult({
    version: "trend/1",
    period,
    filters: { metric, grain, site_ids: args.site_ids, template_ids: args.template_ids },
    cache,
    feeds: [...feeds],
    metrics: {
      buckets: table.length,
      fitted_buckets: fitted.length,
      slope_per_bucket: Number.isFinite(slope) ? round(slope, 3) : null,
      direction,
      mean_value: Number.isFinite(avg) ? round(avg, 2) : null,
      total,
      unit: unit || "count",
    },
    table,
    method:
      `${METHOD[metric]} Buckets are UTC ${grain === "week" ? "ISO weeks (Monday start)" : "calendar months"} clipped to the period. ` +
      `Slope is an ordinary least-squares fit of value on bucket index; direction is only stated with at least ${MIN_TREND_BUCKETS} usable buckets and is "flat" when the fitted change is under 5% of the mean.`,
    caveats,
    now,
  });
  const summary =
    `${LABEL[metric]} by ${grain} over ${period.label}: ${table.length} buckets` +
    (total !== null ? `, ${total} in total` : Number.isFinite(avg) ? `, mean ${round(avg, 1)}${unit}` : "") +
    `; trend ${direction}${Number.isFinite(slope) && fitted.length >= MIN_TREND_BUCKETS ? ` (${round(slope, 2)}${unit} per ${grain})` : ""}.`;
  return { result, summary };
}

const LABEL: Record<TrendMetric, string> = {
  inspections_completed: "Inspections completed",
  average_score: "Average inspection score",
  failed_item_rate: "Failed-item rate",
  issues_created: "Issues created",
  actions_created: "Actions created",
  actions_completed: "Actions completed",
};
const METHOD: Record<TrendMetric, string> = {
  inspections_completed: "Count of non-archived inspections by date_completed.",
  average_score: "Mean score_percentage of completed, non-archived inspections that are scored (max_score > 0); n = scored inspections.",
  failed_item_rate:
    "Failed items / answered items x 100 for inspections completed in the bucket. Answered = active question or list item with a non-blank response (the core failed-items definition); n = answered items.",
  issues_created: "Count of issues by created_at.",
  actions_created: "Count of actions by created_at.",
  actions_completed: "Count of completed actions (status complete, as in the core backlog) by completed_at.",
};
