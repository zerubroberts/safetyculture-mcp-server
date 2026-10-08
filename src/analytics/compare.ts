import type { AnalyticResult, CacheReader } from "../cache/contract.js";
import { ToolError } from "../core/errors.js";
import { parsePeriod, previousPeriod, type Period } from "../core/time.js";
import { buildResult, feedProblem, nameMaps, unavailableSentence } from "./common.js";
import { loadActions, resolutionDays } from "./backlog.js";
import { answeredItems, canon, completedInspections } from "./failed-items.js";
import { mannWhitney, median, mean, pct, round, twoProportionTest, type TestResult } from "./stats.js";

/**
 * Significance-tested comparison of two periods or two site groups.
 * Feed fields: see failed-items.ts (inspections, inspection_items) and backlog.ts (actions).
 */

export const COMPARE_VERSION = "compare/1";

export interface CompareArgs {
  mode?: "periods" | "sites";
  period_a?: string;
  period_b?: string;
  site_ids?: string[];
  site_ids_a?: string[];
  site_ids_b?: string[];
}

export interface CompareRow {
  measure: "failed_item_rate" | "average_score" | "action_resolution_days";
  a_value: number | null;
  b_value: number | null;
  a_n: number;
  b_n: number;
  test: string;
  statistic: number | null;
  /** Three significant figures; below 0.0001 it is the string "< 0.0001", so a tiny p never reads as 0. */
  p_value: number | "< 0.0001" | null;
  effect_size: number | null;
  effect_label: TestResult["effect_label"];
  verdict: TestResult["verdict"];
  explanation: string;
}

interface Side {
  label: string;
  period: Period;
  site_ids?: string[];
}

function sideStats(cache: CacheReader, s: Side) {
  const insp = completedInspections(cache, s.period, { site_ids: s.site_ids });
  const { failed, answered } = answeredItems(cache, insp);
  const scores = [...insp.values()].map((i) => i.score_pct).filter((x): x is number => x !== undefined);
  const res = resolutionDays(loadActions(cache, { site_ids: s.site_ids }), s.period).days;
  return { inspections: insp.size, failed, answered, scores, res };
}

/** p-value for output: never rounded to 0. Below 0.0001 (beyond the normal approximation's accuracy) it is a bound. */
export const reportP = (p: number): CompareRow["p_value"] => (!Number.isFinite(p) ? null : p < 0.0001 ? "< 0.0001" : Number(p.toPrecision(3)));

const fmtP = (p: number) => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);

function explain(measure: string, unit: string, a: number | null, b: number | null, an: number, bn: number, r: TestResult, labels: [string, string]): string {
  const va = a === null ? "n/a" : `${a}${unit}`;
  const vb = b === null ? "n/a" : `${b}${unit}`;
  const base = `${measure}: ${labels[0]} ${va} (n=${an}) vs ${labels[1]} ${vb} (n=${bn}).`;
  if (r.verdict === "not enough data") return `${base} Not enough data to tell whether these differ.`;
  if (r.verdict === "probably noise") return `${base} The gap is within what chance alone would produce (${fmtP(r.p_value)}); treat it as noise.`;
  return `${base} The gap is unlikely to be chance (${fmtP(r.p_value)}); effect size is ${r.effect_label}.`;
}

export function analyzeCompare(cache: CacheReader, args: CompareArgs, now: Date): { summary: string; result: AnalyticResult<CompareRow> } {
  const mode = args.mode ?? (args.site_ids_a?.length || args.site_ids_b?.length ? "sites" : "periods");
  const names = nameMaps(cache);
  let A: Side;
  let B: Side;
  if (mode === "sites") {
    if (!args.site_ids_a?.length || !args.site_ids_b?.length) throw new ToolError("Site comparison needs both site_ids_a and site_ids_b.");
    const overlap = args.site_ids_a.filter((x) => args.site_ids_b!.some((y) => canon(y) === canon(x)));
    if (overlap.length) throw new ToolError(`The two site groups overlap (${overlap.join(", ")}); a site can only be in one group.`);
    const period = parsePeriod(args.period_a, now, "last 90 days");
    const label = (xs: string[]) => (xs.length === 1 ? (names.sites.get(xs[0]!) ?? xs[0]!) : `${xs.length} sites`);
    A = { label: label(args.site_ids_a), period, site_ids: args.site_ids_a };
    B = { label: label(args.site_ids_b), period, site_ids: args.site_ids_b };
  } else {
    const pa = parsePeriod(args.period_a, now, "last 30 days");
    const pb = args.period_b ? parsePeriod(args.period_b, now) : previousPeriod(pa);
    A = { label: "period A", period: pa, site_ids: args.site_ids };
    B = { label: "period B", period: pb, site_ids: args.site_ids };
  }
  const a = sideStats(cache, A);
  const b = sideStats(cache, B);
  const labels: [string, string] = [A.label, B.label];

  const fr = twoProportionTest(a.failed, a.answered, b.failed, b.answered);
  const sc = mannWhitney(a.scores, b.scores);
  const rs = mannWhitney(a.res, b.res);
  const num = (x: number) => (Number.isFinite(x) ? round(x, 4) : null);
  const mk = (measure: CompareRow["measure"], title: string, unit: string, av: number | null, bv: number | null, an: number, bn: number, r: TestResult): CompareRow => ({
    measure,
    a_value: av,
    b_value: bv,
    a_n: an,
    b_n: bn,
    test: r.test,
    statistic: num(r.statistic),
    p_value: reportP(r.p_value),
    effect_size: num(r.effect_size),
    effect_label: r.effect_label,
    verdict: r.verdict,
    explanation: explain(title, unit, av, bv, an, bn, r, labels),
  });
  // Measures from an unreadable feed are left out (never tested on zeros).
  const noInsp = feedProblem(cache, "inspections");
  const noItems = noInsp ?? feedProblem(cache, "inspection_items");
  const noActions = feedProblem(cache, "actions");
  const fRow = noItems ? undefined : mk("failed_item_rate", "Failed-item rate", "%", pct(a.failed, a.answered, 2), pct(b.failed, b.answered, 2), a.answered, b.answered, fr);
  const sRow = noInsp ? undefined : mk("average_score", "Average inspection score", "%", round(mean(a.scores), 1), round(mean(b.scores), 1), a.scores.length, b.scores.length, sc);
  const rRow = noActions ? undefined : mk("action_resolution_days", "Median action resolution", " days", round(median(a.res), 1), round(median(b.res), 1), a.res.length, b.res.length, rs);
  const table: CompareRow[] = [fRow, sRow, rRow].filter((r): r is CompareRow => r !== undefined);
  const caveats: string[] = [];
  if (noInsp) caveats.push(`Average inspection score is not compared: ${noInsp}.`);
  if (noItems) caveats.push(`Failed-item rate is not compared: ${noItems}.`);
  if (noActions) caveats.push(`Action resolution is not compared: ${noActions}.`);

  const result = buildResult({
    version: COMPARE_VERSION,
    period: A.period,
    filters: {
      mode,
      group_a: { label: A.label, from: A.period.from.toISOString(), to: A.period.to.toISOString(), site_ids: A.site_ids },
      group_b: { label: B.label, from: B.period.from.toISOString(), to: B.period.to.toISOString(), site_ids: B.site_ids },
    },
    cache,
    feeds: ["inspections", "inspection_items", "actions"],
    metrics: {
      a_inspections: a.inspections,
      b_inspections: b.inspections,
      a_failed_items: noItems ? null : a.failed,
      a_answered_items: noItems ? null : a.answered,
      b_failed_items: noItems ? null : b.failed,
      b_answered_items: noItems ? null : b.answered,
      a_period: A.period.label,
      b_period: B.period.label,
    },
    table,
    method:
      "Failed-item rate: pooled two-proportion z-test with Cohen's h (needs >= 5 expected failures and passes per group). Inspection score and action resolution days: Mann-Whitney U with rank-biserial effect size (needs >= 8 per group). Verdict 'real difference' when p < 0.05.",
    caveats: [
      ...caveats,
      "Repeated inspections of the same site (and items within one inspection) are not independent, so p-values are optimistic; treat borderline results as noise.",
      "Three tests are run at once; at p < 0.05 roughly one in twenty comparisons of truly equal groups will still look 'real'.",
      "A statistical difference is not proof of cause: template mix, inspectors and reporting habits can differ between the groups.",
    ],
    now,
  });
  const parts = [
    fRow ? `failed-item rate ${fRow.a_value ?? "n/a"}% vs ${fRow.b_value ?? "n/a"}% (${fr.verdict})` : "",
    sRow ? `average score ${sRow.a_value ?? "n/a"}% vs ${sRow.b_value ?? "n/a"}% (${sc.verdict})` : "",
    rRow ? `median resolution ${rRow.a_value ?? "n/a"} vs ${rRow.b_value ?? "n/a"} days (${rs.verdict})` : "",
  ].filter(Boolean);
  const gaps = [noItems ? unavailableSentence(" Failed-item figures", noItems) : "", noActions ? unavailableSentence(" Action figures", noActions) : ""].join("");
  const summary = noInsp
    ? `${A.label} vs ${B.label}: ${unavailableSentence("Inspection figures", noInsp)}${gaps}`
    : `${A.label} (${a.inspections} inspections) vs ${B.label} (${b.inspections} inspections): ${parts.join(", ")}.${gaps}`;
  return { summary, result };
}
