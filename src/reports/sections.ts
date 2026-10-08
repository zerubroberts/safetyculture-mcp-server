import { createHash } from "node:crypto";
import type { CacheReader, FeedName } from "../cache/contract.js";
import { coverage, feedProblem, nameMaps, str, unavailableSentence } from "../analytics/common.js";
import { safetyPulse, type PulseRow } from "../analytics/pulse.js";
import { analyzeFailedItems } from "../analytics/failed-items.js";
import { analyzeActionBacklog, isOverdue, loadActions, wholeDays } from "../analytics/backlog.js";
import { analyzeScheduleCompliance } from "../analytics/schedule-compliance.js";
import { isoDay, siteKey } from "../analytics/trend.js";
import type { Cell, Tile } from "./model.js";
import { fmtInstant } from "./model.js";

/**
 * Data sections shared by the reports. Every figure comes from the core analytics pure functions
 * (pulse, failed-items, backlog, schedule-compliance), so a report always matches the tools.
 */

export function orgFingerprint(cache: CacheReader): string {
  for (const feed of ["inspections", "sites", "users", "templates", "actions", "issues"] as FeedName[]) {
    const r = cache.rows(feed).find((x) => str(x.organisation_id));
    if (r) return createHash("sha256").update(String(r.organisation_id)).digest("hex").slice(0, 10);
  }
  return "unknown";
}

export function siteNameMap(cache: CacheReader): Map<string, string> {
  return new Map([...nameMaps(cache).sites.entries()].map(([id, n]) => [siteKey(id)!, n]));
}

const TILE: Record<string, { label: string; unit: string; good?: "up" | "down" }> = {
  inspections_completed: { label: "Inspections completed", unit: "", good: "up" },
  average_score: { label: "Average score", unit: "%", good: "up" },
  failed_item_rate: { label: "Failed-item rate", unit: "%", good: "down" },
  new_issues: { label: "Issues reported", unit: "" },
  actions_created: { label: "Actions created", unit: "" },
  actions_completed: { label: "Actions completed", unit: "", good: "up" },
  missed_scheduled_inspections: { label: "Missed scheduled inspections", unit: "", good: "down" },
  open_overdue_actions: { label: "Open overdue actions", unit: "" },
};

/** Feed whose failure withholds each pulse tile (the failed-item rate also needs inspections). */
const TILE_FEEDS: Record<string, FeedName[]> = {
  inspections_completed: ["inspections"],
  average_score: ["inspections"],
  failed_item_rate: ["inspection_items", "inspections"],
  new_issues: ["issues"],
  actions_created: ["actions"],
  actions_completed: ["actions"],
  open_overdue_actions: ["actions"],
};

/** Why a tile has no value, or null when its feeds are readable. */
function tileProblem(cache: CacheReader, metric: string): string | null {
  for (const f of TILE_FEEDS[metric] ?? []) {
    const p = feedProblem(cache, f);
    if (p) return p;
  }
  return null;
}

/**
 * KPI tiles from the core safety pulse: deltas only where the pulse states a direction (>= 20 observations both
 * periods). A figure the pulse withholds because its feed cannot be read becomes an "n/a" tile with the reason.
 */
export function pulseSections(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  const pulse = safetyPulse(cache, { period, site_ids: siteIds }, now);
  const r = pulse.result;
  const toTile = (row: PulseRow): Tile => {
    const t = TILE[row.metric] ?? { label: row.metric, unit: "" };
    if (row.direction === "snapshot") {
      const max = r.metrics.max_days_overdue;
      return { label: t.label, value: row.current, note: row.current && max !== null ? `most overdue ${max} days (snapshot now)` : "snapshot now" };
    }
    const enough = row.direction !== "too few to compare";
    return {
      label: t.label,
      value: row.current,
      unit: t.unit,
      previous: row.previous,
      delta: enough ? row.delta : null,
      note: enough ? undefined : `too few to compare (${row.n_current} vs ${row.n_previous} observations; needs 20 each)`,
      good: t.good,
    };
  };
  const tiles: Tile[] = [];
  for (const metric of Object.keys(TILE)) {
    const row = r.table.find((x) => x.metric === metric);
    if (row) tiles.push(toTile(row));
    else {
      const problem = tileProblem(cache, metric);
      if (problem) tiles.push({ label: TILE[metric]!.label, value: null, unit: TILE[metric]!.unit, note: `unavailable: ${problem}` });
    }
  }
  for (const row of r.table) if (!TILE[row.metric]) tiles.push(toTile(row));
  const attention = r.attention.map((a) => ({ text: a.detail, href: a.link }));
  return { pulse, tiles, attention };
}

export interface FailedItemRow {
  template: string;
  label: string;
  failed: number;
  answered: number;
  failure_rate: number | null;
  share: number | null;
  cumulative_share: number | null;
  examples: string[];
}

/**
 * Failed-item Pareto by item (normalised label within template), from the core failed-items analytic.
 * When a feed cannot be read the totals are null and `unavailable` carries the analytic's reason.
 */
export function topFailedItems(cache: CacheReader, period: string, siteIds: string[] | undefined, top: number, now: Date) {
  const { summary, result } = analyzeFailedItems(cache, { period, site_ids: siteIds, group_by: "item", top }, now);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const rows: FailedItemRow[] = result.table.map((r) => ({
    template: r.template ?? "",
    label: r.group,
    failed: r.failed,
    answered: r.answered,
    failure_rate: r.failure_rate_pct,
    share: r.share_pct,
    cumulative_share: r.cumulative_share_pct,
    examples: r.example_inspections.map((e) => e.id),
  }));
  const totalFailed = num(result.metrics.failed_items);
  return { rows, totalFailed, totalAnswered: num(result.metrics.answered_items), unavailable: totalFailed === null ? summary : null };
}

export interface OverdueRow {
  id: string;
  title: string;
  site: string;
  priority: string;
  due: string;
  days_overdue: number;
}

/**
 * Open actions due before now (core loadActions + isOverdue), most overdue first. When the actions feed
 * cannot be read there are no rows and `unavailable` says why: an empty list would read as "none overdue".
 */
export function overdueActions(cache: CacheReader, siteIds: string[] | undefined, now: Date): { rows: OverdueRow[]; unavailable: string | null } {
  const problem = feedProblem(cache, "actions");
  if (problem) return { rows: [], unavailable: unavailableSentence("Action figures", problem) };
  const t = now.getTime();
  const names = siteNameMap(cache);
  const rows = loadActions(cache, { site_ids: siteIds })
    .filter((a) => isOverdue(a, t))
    .map((a) => ({
      id: a.id,
      title: a.title ?? "(untitled action)",
      site: a.site_id ? (names.get(siteKey(a.site_id) ?? "") ?? a.site_id) : "(no site)",
      priority: a.priority,
      due: isoDay(a.due_ms!),
      days_overdue: wholeDays(a.due_ms!, t),
    }))
    .sort((a, b) => b.days_overdue - a.days_overdue || a.id.localeCompare(b.id));
  return { rows, unavailable: null };
}

/** Core action backlog for the scope; resolution and flow over the period. `unavailable` is set when its figures are withheld. */
export function backlogSummary(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  const { summary, result } = analyzeActionBacklog(cache, { period, site_ids: siteIds }, now);
  return { ...result, unavailable: result.metrics.open === null ? summary : null };
}

/** Core schedule compliance. `metrics.due` is null when the occurrences feed is empty (no scheduling data). */
export function scheduleSummary(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  return analyzeScheduleCompliance(cache, { period, site_ids: siteIds }, now).result;
}

/** Coverage column: a feed that cannot back a figure reads "unavailable", never "partial". */
function coverageText(cache: CacheReader, c: ReturnType<typeof coverage>[number]): string {
  if (c.note === "still syncing") return "unavailable (still downloading)";
  if (feedProblem(cache, c.feed)) return "unavailable";
  if (c.complete) return "complete";
  if (c.last_error) return "stale (latest refresh failed)";
  return "partial (row cap)";
}

export function coverageTable(cache: CacheReader, feeds: FeedName[]): Cell[][] {
  return coverage(cache, feeds).map((c) => [c.feed, c.rows, c.last_synced_at ? fmtInstant(c.last_synced_at) : "never synced", coverageText(cache, c)]);
}
