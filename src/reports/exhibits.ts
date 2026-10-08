import type { CacheReader } from "../cache/contract.js";
import type { Period } from "../core/time.js";
import { feedProblem, unavailableSentence } from "../analytics/common.js";
import type { PulseRow } from "../analytics/pulse.js";
import { computeTrend, type Grain, type TrendMetric } from "../analytics/trend.js";
import type { Block, Tile } from "./model.js";
import { fmt } from "./model.js";

/**
 * Helpers shared by the report builders: trend series for sparklines and charts, action titles that
 * state the takeaway, and executive-summary sentences. Every number in a title or sentence is read
 * from an analytics output passed in; nothing here computes a new metric.
 */

/** Figures withheld because a feed cannot be read. */
export const unavailableBlock = (text: string): Block => ({ kind: "unavailable", text });

/** Inspection-based trends: the trend analytic checks its own source feed; these also need inspections. */
export const INSPECTION_TRENDS = new Set<TrendMetric>(["inspections_completed", "average_score", "failed_item_rate"]);

export interface Series {
  labels: string[];
  values: Array<number | null>;
  partial: boolean[];
  /** The analytic's direction: rising, falling, flat or "not stated (...)". */
  direction: string;
  mean: number | null;
  total: number | null;
}

/** Trend series from the trend analytic, or the reason it is unavailable. */
export function trendSeries(cache: CacheReader, metric: TrendMetric, grain: Grain, period: Period, siteIds: string[] | undefined, now: Date): { series: Series | null; problem: string | null } {
  const noInsp = INSPECTION_TRENDS.has(metric) ? feedProblem(cache, "inspections") : null;
  if (noInsp) return { series: null, problem: noInsp };
  const { result: t, summary } = computeTrend(cache, { metric, grain, period, site_ids: siteIds }, now);
  if (t.metrics.buckets === null) return { series: null, problem: summary };
  return {
    series: {
      labels: t.table.map((r) => r.bucket),
      values: t.table.map((r) => r.value),
      partial: t.table.map((r) => r.partial),
      direction: String(t.metrics.direction),
      mean: (t.metrics.mean_value as number | null) ?? null,
      total: (t.metrics.total as number | null) ?? null,
    },
    problem: null,
  };
}

const SPARK_METRIC: Record<string, TrendMetric> = {
  "Inspections completed": "inspections_completed",
  "Average score": "average_score",
  "Failed-item rate": "failed_item_rate",
  "Issues reported": "issues_created",
  "Actions created": "actions_created",
  "Actions completed": "actions_completed",
};

/** Adds sparklines to KPI tiles whose metric has a trend; withheld tiles (value null) stay without one. */
export function withSparks(tiles: Tile[], cache: CacheReader, grain: Grain, period: Period, siteIds: string[] | undefined, now: Date, label: string): Tile[] {
  return tiles.map((t) => {
    const metric = SPARK_METRIC[t.label];
    if (!metric || t.value === null) return t;
    const { series } = trendSeries(cache, metric, grain, period, siteIds, now);
    if (!series || series.values.filter((v) => v !== null).length < 2) return t;
    return { ...t, spark: series.values, sparkPartial: series.partial, sparkLabel: label };
  });
}

/** "rising" -> "is rising"; unstated directions say why. */
export function directionPhrase(direction: string): string {
  if (direction === "rising") return "is rising";
  if (direction === "falling") return "is falling";
  if (direction === "flat") return "is holding flat";
  return "has too few full periods to call a trend";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

const pts = (d: number) => `${fmt(Math.abs(d))} point${Math.abs(d) === 1 ? "" : "s"}`;

/**
 * Executive-summary sentences from the safety pulse rows. A withheld figure says so with the reason;
 * comparisons appear only where the pulse states a direction (enough observations in both periods).
 */
export function pulseSentences(cache: CacheReader, rows: PulseRow[], maxDaysOverdue: number | null): string[] {
  const out: string[] = [];
  const row = (m: string) => rows.find((r) => r.metric === m);
  const compared = (r: PulseRow) => r.direction === "up" || r.direction === "down" || r.direction === "no change";
  const insp = row("inspections_completed");
  if (insp && insp.current !== null) {
    const d = insp.delta ?? 0;
    const cmp = !compared(insp) ? "" : insp.direction === "no change" ? ", the same as the previous period" : `, ${fmt(Math.abs(d))} ${d > 0 ? "more" : "fewer"} than the previous period`;
    out.push(`${plural(insp.current, "inspection")} ${insp.current === 1 ? "was" : "were"} completed${cmp}.`);
  } else {
    const p = feedProblem(cache, "inspections");
    if (p) out.push(unavailableSentence("Inspection figures", p));
  }
  const score = row("average_score");
  const rate = row("failed_item_rate");
  const rateBits: string[] = [];
  if (score && score.current !== null) rateBits.push(`the average score was ${fmt(score.current)}%${compared(score) && score.delta ? ` (${score.delta > 0 ? "up" : "down"} ${pts(score.delta)})` : ""}`);
  if (rate && rate.current !== null) rateBits.push(`the failed-item rate was ${fmt(rate.current)}%${compared(rate) && rate.delta ? ` (${rate.delta > 0 ? "up" : "down"} ${pts(rate.delta)})` : ""}`);
  if (rateBits.length) {
    const s = rateBits.join(" and ");
    out.push(`${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
  } else if (!rate) {
    const p = feedProblem(cache, "inspection_items");
    if (p && !feedProblem(cache, "inspections")) out.push(unavailableSentence("Failed-item figures", p));
  }
  const overdue = row("open_overdue_actions");
  if (overdue && overdue.current !== null) {
    out.push(
      overdue.current === 0
        ? "No open actions are past their due date."
        : `${plural(overdue.current, "open action")} ${overdue.current === 1 ? "is" : "are"} past due${maxDaysOverdue !== null ? `, the oldest by ${plural(maxDaysOverdue, "day")}` : ""}.`,
    );
  } else {
    const p = feedProblem(cache, "actions");
    if (p) out.push(unavailableSentence("Action figures", p));
  }
  const missed = row("missed_scheduled_inspections");
  if (missed && missed.current !== null && missed.current > 0) out.push(`${plural(missed.current, "scheduled inspection")} ${missed.current === 1 ? "was" : "were"} missed.`);
  return out;
}
