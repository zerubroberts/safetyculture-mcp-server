import type { CacheReader } from "../cache/contract.js";
import { links } from "../core/params.js";
import type { Period } from "../core/time.js";
import { bounded, buildResult, feedProblem, groupBy, unavailableSentence } from "./common.js";
import { median, pct, round } from "./stats.js";
import { FAST_SHARE, MIN_TEMPLATE_DURATIONS, templateMedianDurations } from "./inspectors.js";
import { completedInspections, isoDay, itemCounts, itemsByInspection, type Insp, type ScopeFilter } from "./trend.js";

/**
 * Patterns in inspection data worth a second look. These are review prompts, never findings:
 * a fast inspection can be a short walk-through, a perfect streak can be a well-run area.
 */

export const ANOMALY_KINDS = ["too_fast", "perfect_streak", "duplicate_burst", "score_outlier"] as const;
export type AnomalyKind = (typeof ANOMALY_KINDS)[number];

export const STREAK_MIN = 10;
export const STREAK_TEMPLATE_FAIL_RATE = 5;
export const BURST_MIN = 3;
export const BURST_WINDOW_MS = 5 * 60_000;
export const ROBUST_Z = 3.5;
export const MIN_TEMPLATE_SCORES = 10;

export interface AnomalyArgs extends ScopeFilter {
  kinds: AnomalyKind[];
  period: Period;
  /** Max flags returned (default 50), most severe of each kind first; counts always cover every flag. */
  limit?: number;
}

export interface AnomalyRow {
  kind: AnomalyKind;
  inspection_id: string;
  inspection_name?: string;
  template_id?: string;
  template_name?: string;
  inspector_id?: string;
  inspector_name?: string;
  completed_at: string;
  reason: string;
  evidence: Record<string, number | string | null>;
  /** All inspections in the streak or burst (first one is `inspection_id`). */
  related_ids?: string[];
  link: string;
}

const base = (k: AnomalyKind, i: Insp, reason: string, evidence: AnomalyRow["evidence"], related?: string[]): AnomalyRow => ({
  kind: k,
  inspection_id: i.id,
  inspection_name: i.name,
  template_id: i.templateId,
  template_name: i.templateName,
  inspector_id: i.ownerId,
  inspector_name: i.ownerName,
  completed_at: new Date(i.completedAt).toISOString(),
  reason,
  evidence,
  related_ids: related,
  link: links.inspection(i.id),
});

const chrono = (a: Insp, b: Insp) => a.completedAt - b.completedAt || a.id.localeCompare(b.id);

/** How strongly a flag matches its own pattern (higher = stronger); only compared within one kind. */
const severity = (r: AnomalyRow): number => {
  const e = r.evidence;
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  if (r.kind === "too_fast") return -n(e.share_of_median_pct);
  if (r.kind === "perfect_streak") return n(e.streak_length);
  if (r.kind === "duplicate_burst") return n(e.inspections_in_burst);
  return Math.abs(n(e.robust_z));
};

/**
 * Stable ranking for a capped list: within each kind strongest first (then oldest, then ID), and the kinds
 * interleaved in ANOMALY_KINDS order, so a limit keeps the strongest flags of every kind checked.
 */
export function rankAnomalies(rows: AnomalyRow[]): AnomalyRow[] {
  const perKind = ANOMALY_KINDS.map((k) =>
    rows
      .filter((r) => r.kind === k)
      .sort((a, b) => severity(b) - severity(a) || a.completed_at.localeCompare(b.completed_at) || a.inspection_id.localeCompare(b.inspection_id)),
  );
  const out: AnomalyRow[] = [];
  const longest = Math.max(0, ...perKind.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const list of perKind) if (i < list.length) out.push(list[i]!);
  return out;
}

export function computeAnomalies(cache: CacheReader, args: AnomalyArgs, now: Date) {
  const filters = { kinds: args.kinds, site_ids: args.site_ids, template_ids: args.template_ids };
  const feeds = ["inspections", ...(args.kinds.includes("perfect_streak") ? (["inspection_items"] as const) : [])] as Array<"inspections" | "inspection_items">;
  // Every pattern is read from inspections: unreadable means no checks were run, not "nothing flagged".
  const noInsp = feedProblem(cache, "inspections");
  if (noInsp) {
    const result = buildResult<AnomalyRow>({
      version: "anomalies/1",
      period: args.period,
      filters,
      cache,
      feeds,
      metrics: { inspections_in_scope: null, flagged: null, ...Object.fromEntries(args.kinds.map((k) => [k, null])) },
      table: [],
      method: "Anomaly checks need the inspections feed; it could not be read, so no checks were run.",
      caveats: [`No anomaly checks: ${noInsp}. This is not "nothing flagged".`],
      now,
    });
    return { result: { ...result, total: 0, truncated: false }, summary: unavailableSentence("Anomaly checks", noInsp) };
  }
  // Perfect streaks need item failure rates; without the items feed that check is not run.
  const noItems = args.kinds.includes("perfect_streak") ? feedProblem(cache, "inspection_items") : null;
  const window = { from: args.period.from.getTime(), to: args.period.to.getTime() };
  // Baselines use every completed inspection in the period; the scope only limits what is flagged.
  const all = completedInspections(cache, window);
  const scoped = completedInspections(cache, window, args);
  const kinds = new Set(args.kinds);
  const table: AnomalyRow[] = [];
  const checked: Record<string, number | string | null> = {};

  if (kinds.has("too_fast")) {
    const medians = templateMedianDurations(all);
    let n = 0;
    for (const i of scoped) {
      const m = medians.get(i.templateKey ?? "");
      if (!m || i.duration === undefined) continue;
      n++;
      if (i.duration < FAST_SHARE * m.median)
        table.push(
          base("too_fast", i, `Took ${round(i.duration, 0)}s, under ${FAST_SHARE * 100}% of this template's median of ${round(m.median, 0)}s.`, {
            duration_seconds: i.duration,
            template_median_seconds: round(m.median, 1),
            share_of_median_pct: pct(i.duration, m.median, 1),
            template_timed_inspections: m.n,
          }),
        );
    }
    checked.too_fast_checked = n;
  }

  if (kinds.has("perfect_streak") && noItems) checked.perfect_streaks = null;
  else if (kinds.has("perfect_streak")) {
    const counts = itemCounts(itemsByInspection(cache, new Set(all.map((i) => i.key))));
    const tplFail = new Map<string, { answered: number; failed: number }>();
    for (const i of all) {
      const c = counts.get(i.key);
      if (!c || !i.templateKey) continue;
      const t = tplFail.get(i.templateKey) ?? { answered: 0, failed: 0 };
      t.answered += c.answered;
      t.failed += c.failed;
      tplFail.set(i.templateKey, t);
    }
    let streaks = 0;
    for (const [, arr] of groupBy(scoped.filter((i) => i.ownerKey && i.templateKey && i.scorePct !== undefined), (i) => `${i.ownerKey}|${i.templateKey}`)) {
      const t = tplFail.get(arr[0]!.templateKey!);
      const rate = t ? pct(t.failed, t.answered, 1) : null;
      if (rate === null || rate < STREAK_TEMPLATE_FAIL_RATE) continue;
      const sorted = [...arr].sort(chrono);
      let run: Insp[] = [];
      const flush = () => {
        if (run.length >= STREAK_MIN) {
          streaks++;
          table.push(
            base(
              "perfect_streak",
              run[0]!,
              `${run.length} consecutive 100% inspections by the same inspector on a template where ${rate}% of answered items fail organisation-wide.`,
              { streak_length: run.length, first_completed: isoDay(run[0]!.completedAt), last_completed: isoDay(run[run.length - 1]!.completedAt), template_fail_rate_pct: rate },
              run.map((r) => r.id),
            ),
          );
        }
        run = [];
      };
      for (const i of sorted) {
        if (i.scorePct! >= 100) run.push(i);
        else flush();
      }
      flush();
    }
    checked.perfect_streaks = streaks;
  }

  if (kinds.has("duplicate_burst")) {
    let bursts = 0;
    for (const [, arr] of groupBy(scoped.filter((i) => i.ownerKey && i.templateKey), (i) => `${i.ownerKey}|${i.templateKey}`)) {
      const sorted = [...arr].sort(chrono);
      for (let s = 0; s < sorted.length; ) {
        let e = s;
        while (e + 1 < sorted.length && sorted[e + 1]!.completedAt - sorted[s]!.completedAt <= BURST_WINDOW_MS) e++;
        const group = sorted.slice(s, e + 1);
        if (group.length >= BURST_MIN) {
          bursts++;
          const spanMin = round((group[group.length - 1]!.completedAt - group[0]!.completedAt) / 60_000, 1);
          table.push(
            base("duplicate_burst", group[0]!, `${group.length} inspections of the same template by the same inspector completed within ${spanMin} minutes.`, {
              inspections_in_burst: group.length,
              span_minutes: spanMin,
            }, group.map((g) => g.id)),
          );
          s = e + 1;
        } else s++;
      }
    }
    checked.duplicate_bursts = bursts;
  }

  if (kinds.has("score_outlier")) {
    let n = 0;
    const stats = new Map<string, { med: number; mad: number; n: number } | null>();
    for (const [t, arr] of groupBy(all.filter((i) => i.templateKey && i.scorePct !== undefined), (i) => i.templateKey!)) {
      const xs = arr.map((i) => i.scorePct!);
      if (xs.length < MIN_TEMPLATE_SCORES) {
        stats.set(t, null);
        continue;
      }
      const med = median(xs);
      const mad = median(xs.map((x) => Math.abs(x - med)));
      stats.set(t, mad > 0 ? { med, mad, n: xs.length } : null);
    }
    for (const i of scoped) {
      const s = i.templateKey && i.scorePct !== undefined ? stats.get(i.templateKey) : undefined;
      if (!s) continue;
      n++;
      const z = (0.6745 * (i.scorePct! - s.med)) / s.mad;
      if (Math.abs(z) > ROBUST_Z)
        table.push(
          base("score_outlier", i, `Score ${round(i.scorePct!, 1)}% is ${z > 0 ? "far above" : "far below"} this template's median of ${round(s.med, 1)}% (robust z ${round(z, 2)}).`, {
            score_pct: round(i.scorePct!, 1),
            template_median_pct: round(s.med, 1),
            template_mad: round(s.mad, 2),
            robust_z: round(z, 2),
            template_scored_inspections: s.n,
          }),
        );
    }
    checked.score_outlier_checked = n;
  }

  const ranked = rankAnomalies(table);
  const shown = bounded(ranked, args.limit);
  const byKind: Record<string, number | null> = Object.fromEntries(args.kinds.map((k) => [k, k === "perfect_streak" && noItems ? null : table.filter((r) => r.kind === k).length]));
  const caveats = [
    "These are patterns to review, not evidence of wrongdoing. Short walk-throughs, well-run areas, batch data entry after an outage and offline syncs all produce the same patterns.",
    "Duration is the feed's duration field, read as seconds; inspections without a duration are not checked for speed.",
  ];
  if (noItems) caveats.push(`Perfect streaks were not checked: ${noItems}. This is not "no streaks".`);
  if (shown.truncated)
    caveats.push(`Showing ${shown.rows.length} of ${shown.total} flags: the strongest of each kind first, kinds interleaved. Counts per kind cover all ${shown.total}. Raise limit or pick one kind to see the rest.`);
  const result = buildResult({
    version: "anomalies/1",
    period: args.period,
    filters,
    cache,
    feeds,
    metrics: { inspections_in_scope: scoped.length, flagged: table.length, ...byKind, ...checked },
    table: shown.rows,
    method:
      `too_fast: duration under ${FAST_SHARE * 100}% of the template median (templates with >= ${MIN_TEMPLATE_DURATIONS} timed inspections in the period). ` +
      `perfect_streak: >= ${STREAK_MIN} consecutive 100% scores by one inspector on one template whose organisation-wide failed-item rate is >= ${STREAK_TEMPLATE_FAIL_RATE}%. ` +
      `duplicate_burst: >= ${BURST_MIN} inspections of one template by one inspector completed within 5 minutes of the first. ` +
      `score_outlier: robust z = 0.6745 x (score - median) / MAD within the template beyond ${ROBUST_Z} (>= ${MIN_TEMPLATE_SCORES} scored inspections, MAD > 0). Baselines use all completed inspections in the period.`,
    caveats,
    now,
  });
  const parts = args.kinds.map((k) => (byKind[k] === null ? `${k.replace("_", " ")} not checked` : `${byKind[k]} ${k.replace("_", " ")}`)).join(", ");
  return {
    result: { ...result, total: shown.total, truncated: shown.truncated },
    summary:
      `${table.length} inspections match a review pattern over ${args.period.label} (${parts}) out of ${scoped.length} in scope` +
      (shown.truncated ? `; the strongest ${shown.rows.length} are listed` : "") +
      ". These are prompts to look closer, not findings about anyone." +
      (noItems ? ` ${unavailableSentence("Perfect-streak check", noItems)}` : ""),
  };
}
