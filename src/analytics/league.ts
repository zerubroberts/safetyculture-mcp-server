import type { AnalyticResult, CacheReader } from "../cache/contract.js";
import { parsePeriod, previousPeriod, type Period } from "../core/time.js";
import { buildResult, nameMaps } from "./common.js";
import { loadActions, overdueAt, resolutionDays, type Action } from "./backlog.js";
import { answeredItems, canon, completedInspections, idIn } from "./failed-items.js";
import { mean, median, pct, round } from "./stats.js";

/**
 * Site league table. Feed fields: see failed-items.ts (inspections, inspection_items) and backlog.ts (actions).
 */

export const LEAGUE_VERSION = "site-league/1";

export const LEAGUE_METRICS = ["inspections", "average_score", "failed_item_rate", "overdue_actions", "median_resolution_days"] as const;
export type LeagueMetric = (typeof LEAGUE_METRICS)[number];
/** +1 = higher is better, -1 = lower is better. */
export const METRIC_SIGN: Record<LeagueMetric, 1 | -1> = {
  inspections: 1,
  average_score: 1,
  failed_item_rate: -1,
  overdue_actions: -1,
  median_resolution_days: -1,
};

export interface LeagueArgs {
  period?: string;
  site_ids?: string[];
  min_inspections?: number;
  metrics?: LeagueMetric[];
}

export interface LeagueRow {
  rank: number;
  site: string;
  site_id: string;
  inspections: number;
  average_score: number | null;
  failed_item_rate: number | null;
  answered_items: number;
  overdue_actions: number;
  median_resolution_days: number | null;
  composite: number;
  previous_rank: number | null;
  rank_change: number | null;
}

interface SiteStats {
  site_id: string;
  inspections: number;
  scores: number[];
  failed: number;
  answered: number;
  overdue: number;
  resolution: number[];
}

function siteStats(cache: CacheReader, p: Period, actions: Action[], siteIds: string[] | undefined, now: Date): Map<string, SiteStats> {
  const insp = completedInspections(cache, p, { site_ids: siteIds });
  const out = new Map<string, SiteStats>();
  const get = (siteId: string) => {
    const k = canon(siteId);
    let s = out.get(k);
    if (!s) out.set(k, (s = { site_id: siteId, inspections: 0, scores: [], failed: 0, answered: 0, overdue: 0, resolution: [] }));
    return s;
  };
  for (const i of insp.values()) {
    if (!i.site_id) continue;
    const s = get(i.site_id);
    s.inspections++;
    if (i.score_pct !== undefined) s.scores.push(i.score_pct);
  }
  for (const j of answeredItems(cache, insp).items) {
    if (!j.insp.site_id) continue;
    const s = get(j.insp.site_id);
    s.answered++;
    if (j.failed) s.failed++;
  }
  const at = Math.min(p.to.getTime(), now.getTime());
  for (const a of overdueAt(actions, at)) if (a.site_id && out.has(canon(a.site_id))) out.get(canon(a.site_id))!.overdue++;
  for (const a of actions) {
    if (!a.site_id || !out.has(canon(a.site_id))) continue;
    const d = resolutionDays([a], p).days;
    if (d.length) out.get(canon(a.site_id))!.resolution.push(d[0]!);
  }
  return out;
}

const values = (s: SiteStats): Record<LeagueMetric, number | null> => ({
  inspections: s.inspections,
  average_score: s.scores.length ? mean(s.scores) : null,
  failed_item_rate: s.answered ? (100 * s.failed) / s.answered : null,
  overdue_actions: s.overdue,
  median_resolution_days: s.resolution.length ? median(s.resolution) : null,
});

/**
 * Composite = mean over the chosen metrics of the signed z-score (population SD across eligible sites, sign so
 * that higher is always better). A metric a site has no value for is skipped for that site; a metric with zero
 * spread contributes 0.
 */
export function rankSites(stats: SiteStats[], metrics: readonly LeagueMetric[]): Array<{ s: SiteStats; v: Record<LeagueMetric, number | null>; composite: number; rank: number }> {
  const rows = stats.map((s) => ({ s, v: values(s), composite: 0, rank: 0 }));
  const z = new Map<LeagueMetric, { mu: number; sd: number }>();
  for (const m of metrics) {
    const xs = rows.map((r) => r.v[m]).filter((x): x is number => x !== null);
    const mu = mean(xs);
    const sd = xs.length ? Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))) : 0;
    z.set(m, { mu, sd });
  }
  for (const r of rows) {
    const parts: number[] = [];
    for (const m of metrics) {
      const x = r.v[m];
      if (x === null) continue;
      const { mu, sd } = z.get(m)!;
      parts.push(sd > 0 ? (METRIC_SIGN[m] * (x - mu)) / sd : 0);
    }
    r.composite = parts.length ? mean(parts) : 0;
  }
  rows.sort((a, b) => b.composite - a.composite || canon(a.s.site_id).localeCompare(canon(b.s.site_id)));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

export function analyzeSiteLeague(
  cache: CacheReader,
  args: LeagueArgs,
  now: Date,
): { summary: string; result: AnalyticResult<LeagueRow> & { below_minimum: Array<{ site: string; site_id: string; inspections: number; reason: string }> } } {
  const period = parsePeriod(args.period, now, "last 90 days");
  const prev = previousPeriod(period);
  const minN = args.min_inspections ?? 10;
  const metrics = args.metrics?.length ? [...new Set(args.metrics)] : [...LEAGUE_METRICS];
  const names = nameMaps(cache);
  const actions = loadActions(cache, { site_ids: args.site_ids });

  const cur = siteStats(cache, period, actions, args.site_ids, now);
  const eligible = [...cur.values()].filter((s) => s.inspections >= minN);
  const below = [...cur.values()]
    .filter((s) => s.inspections < minN)
    .sort((a, b) => b.inspections - a.inspections || canon(a.site_id).localeCompare(canon(b.site_id)))
    .map((s) => ({
      site: names.sites.get(s.site_id) ?? s.site_id,
      site_id: s.site_id,
      inspections: s.inspections,
      reason: `${s.inspections} completed inspections, below the minimum of ${minN}.`,
    }));
  const prevRanks = new Map(
    rankSites(
      [...siteStats(cache, prev, actions, args.site_ids, now).values()].filter((s) => s.inspections >= minN),
      metrics,
    ).map((r) => [canon(r.s.site_id), r.rank]),
  );

  const table: LeagueRow[] = rankSites(eligible, metrics).map(({ s, v, composite, rank }) => {
    const pr = prevRanks.get(canon(s.site_id)) ?? null;
    return {
      rank,
      site: names.sites.get(s.site_id) ?? s.site_id,
      site_id: s.site_id,
      inspections: s.inspections,
      average_score: v.average_score === null ? null : round(v.average_score, 1),
      failed_item_rate: pct(s.failed, s.answered, 2),
      answered_items: s.answered,
      overdue_actions: s.overdue,
      median_resolution_days: v.median_resolution_days === null ? null : round(v.median_resolution_days, 1),
      composite: round(composite, 3) ?? 0,
      previous_rank: pr,
      rank_change: pr === null ? null : pr - rank,
    };
  });

  const caveats = [
    "The composite is a relative ranking among the listed sites, not an absolute safety rating; sites with different work and templates are not strictly comparable.",
    "Higher inspection volume ranks better and higher open overdue action counts rank worse; both scale with site size.",
    "Open overdue actions are counted as at the end of the period (or now), reconstructed from created, due and completed dates.",
    "Sites with no completed inspections in the period are not listed.",
  ];
  if (table.length < 3) caveats.push("Fewer than three sites qualify, so z-scores carry little information.");
  const unsited = [...completedInspections(cache, period, { site_ids: args.site_ids }).values()].filter((i) => !i.site_id).length;
  if (unsited) caveats.push(`${unsited} completed inspections have no site and are not in the league.`);
  if (args.site_ids?.length) for (const id of args.site_ids) if (!idIn(id, [...cur.values()].map((s) => s.site_id))) caveats.push(`Site ${id} had no completed inspections in the period.`);

  const result = buildResult({
    version: LEAGUE_VERSION,
    period,
    filters: { site_ids: args.site_ids, min_inspections: minN, metrics },
    cache,
    feeds: ["inspections", "inspection_items", "actions", "sites"],
    metrics: { ranked_sites: table.length, below_minimum: below.length, min_inspections: minN, metrics_used: metrics.join(", ") },
    table,
    method:
      "For each metric, sites get a z-score (population SD across ranked sites), signed so higher is better (failed-item rate, overdue actions and resolution days count against). Composite = equal-weight mean of the available z-scores; rank change = previous-period rank minus current rank.",
    caveats,
    now,
  });
  const top = table[0];
  const bottom = table[table.length - 1];
  const summary = table.length
    ? `${table.length} sites ranked ${period.label} (min ${minN} inspections; ${below.length} below minimum). Top: ${top!.site} (${top!.inspections} inspections, composite ${top!.composite}); bottom: ${bottom!.site} (composite ${bottom!.composite}).`
    : `No site reached ${minN} completed inspections ${period.label}; ${below.length} sites are listed below the minimum.`;
  return { summary, result: { ...result, below_minimum: below } };
}
