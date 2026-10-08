import type { CacheReader, FeedName } from "../cache/contract.js";
import { previousPeriod, type Period } from "../core/time.js";
import { buildResult, feedProblem, nameMaps, str, unavailableSentence } from "./common.js";
import { pct, round } from "./stats.js";
import { completedInspections, inWindow, siteKey, siteSet, toTime } from "./trend.js";

/**
 * Issue hotspots: issues by category x site, normalised by inspection volume where possible.
 * issues fields: id, created_at, site_id, site_name, category_id, category_label.
 */

export const RISING_MIN = 10;
export const HOTSPOTS_VERSION = "issue-hotspots/1";

export interface HotspotArgs {
  period: Period;
  site_ids?: string[];
  limit: number;
}

export interface HotspotRow {
  category: string;
  site_id: string | null;
  site_name: string;
  issues: number;
  site_inspections: number;
  per_100_inspections: number | null;
}

const UNCATEGORISED = "(uncategorised)";
const NO_SITE = "(no site)";
const categoryOf = (r: Record<string, unknown>) => str(r.category_label)?.trim() || str(r.category_id) || UNCATEGORISED;

export function computeHotspots(cache: CacheReader, args: HotspotArgs, now: Date) {
  const sites = siteSet(args.site_ids);
  const prev = previousPeriod(args.period);
  const feeds: FeedName[] = ["issues", "inspections", "sites"];

  // Unreadable issues feed: issue counts are missing, not zero.
  const problem = feedProblem(cache, "issues");
  if (problem) {
    const result = buildResult<HotspotRow>({
      version: HOTSPOTS_VERSION,
      period: args.period,
      filters: { site_ids: args.site_ids },
      cache,
      feeds,
      metrics: { issues: null, previous_period_issues: null, categories: null, sites: null, rising_categories: null },
      table: [],
      method: "Issue hotspots need the issues feed; it could not be read, so no issue figures are computed.",
      caveats: [`No issue figures: ${problem}. This is not zero issues.`],
      now,
    });
    return { result: { ...result, by_category: [], rising: [] }, summary: unavailableSentence("Issue figures", problem) };
  }
  const names = nameMaps(cache);
  const siteNames = new Map([...names.sites.entries()].map(([id, n]) => [siteKey(id)!, n]));
  const issues = cache.rows("issues").filter((r) => !sites || sites.has(siteKey(r.site_id) ?? ""));
  const created = (r: Record<string, unknown>, p: Period) => inWindow(toTime(r.created_at), p.from.getTime(), p.to.getTime());
  const cur = issues.filter((r) => created(r, args.period));
  const before = issues.filter((r) => created(r, prev));

  const inspPerSite = new Map<string, number>();
  for (const i of completedInspections(cache, { from: args.period.from.getTime(), to: args.period.to.getTime() }, { site_ids: args.site_ids }))
    if (i.siteKey) inspPerSite.set(i.siteKey, (inspPerSite.get(i.siteKey) ?? 0) + 1);

  const cells = new Map<string, HotspotRow>();
  for (const r of cur) {
    const sk = siteKey(r.site_id);
    const cat = categoryOf(r);
    const k = `${cat}\u0000${sk ?? ""}`;
    let c = cells.get(k);
    if (!c) {
      const n = sk ? (inspPerSite.get(sk) ?? 0) : 0;
      c = { category: cat, site_id: str(r.site_id) ?? null, site_name: (sk ? siteNames.get(sk) : undefined) ?? str(r.site_name) ?? (sk ? String(r.site_id) : NO_SITE), issues: 0, site_inspections: n, per_100_inspections: null };
      cells.set(k, c);
    }
    c.issues++;
  }
  // Unreadable inspections feed: per-inspection rates are unknown, not zero or infinite.
  const noInsp = feedProblem(cache, "inspections");
  for (const c of cells.values()) c.per_100_inspections = !noInsp && c.site_inspections > 0 ? round((100 * c.issues) / c.site_inspections, 1) : null;
  const table = [...cells.values()].sort((a, b) => b.issues - a.issues || (b.per_100_inspections ?? -1) - (a.per_100_inspections ?? -1) || a.category.localeCompare(b.category) || a.site_name.localeCompare(b.site_name));

  const catCount = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(categoryOf(r), (m.get(categoryOf(r)) ?? 0) + 1);
    return m;
  };
  const nowCats = catCount(cur);
  const prevCats = catCount(before);
  const by_category = [...nowCats.entries()]
    .map(([category, issues]) => ({ category, issues, previous: prevCats.get(category) ?? 0, share_pct: pct(issues, cur.length, 1) }))
    .sort((a, b) => b.issues - a.issues || a.category.localeCompare(b.category));
  const rising = by_category
    .filter((c) => c.issues >= RISING_MIN && c.issues > c.previous)
    .map((c) => ({ category: c.category, issues: c.issues, previous: c.previous, change: c.issues - c.previous, change_pct: c.previous > 0 ? pct(c.issues - c.previous, c.previous, 1) : null }))
    .sort((a, b) => b.change - a.change || a.category.localeCompare(b.category));

  const caveats = ["Lower issue counts can mean less reporting, not fewer hazards; higher counts at a site can reflect a strong reporting culture."];
  if (cur.some((r) => !siteKey(r.site_id))) caveats.push(`${cur.filter((r) => !siteKey(r.site_id)).length} issues have no site and cannot be normalised by inspections.`);
  if (noInsp) caveats.push(`Per-inspection rates are unavailable: ${noInsp}.`);
  else if (!inspPerSite.size) caveats.push("No completed inspections in scope for this period, so per-inspection rates are unavailable.");

  const result = buildResult({
    version: HOTSPOTS_VERSION,
    period: args.period,
    filters: { site_ids: args.site_ids },
    cache,
    feeds,
    metrics: {
      issues: cur.length,
      previous_period_issues: before.length,
      categories: nowCats.size,
      sites: new Set(cur.map((r) => siteKey(r.site_id) ?? "")).size,
      rising_categories: rising.length,
    },
    table: table.slice(0, args.limit),
    method:
      `Issues by created_at in the period, grouped by category_label x site. Rate = issues / completed inspections at that site in the same period x 100. ` +
      `Rising = a category with >= ${RISING_MIN} issues this period and more than in the previous period of equal length (${prev.label}).`,
    caveats,
    now,
  });
  const topCell = table[0];
  return {
    result: { ...result, by_category, rising },
    summary:
      `${cur.length} issues over ${args.period.label} (previous period ${before.length}) across ${nowCats.size} categories` +
      (topCell ? `; top hotspot: ${topCell.category} at ${topCell.site_name} with ${topCell.issues}` : "") +
      `; ${rising.length} rising categories.`,
  };
}
