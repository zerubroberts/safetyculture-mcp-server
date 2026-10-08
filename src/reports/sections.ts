import { createHash } from "node:crypto";
import type { CacheReader, FeedName } from "../cache/contract.js";
import { coverage, nameMaps, str } from "../analytics/common.js";
import { safetyPulse, type PulseRow } from "../analytics/pulse.js";
import { analyzeFailedItems } from "../analytics/failed-items.js";
import { analyzeActionBacklog, isOverdue, loadActions, wholeDays } from "../analytics/backlog.js";
import { analyzeScheduleCompliance } from "../analytics/schedule-compliance.js";
import { isoDay, siteKey } from "../analytics/trend.js";
import type { Cell, Tile } from "./model.js";

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

/** KPI tiles from the core safety pulse: deltas only where the pulse states a direction (>= 20 observations both periods). */
export function pulseSections(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  const pulse = safetyPulse(cache, { period, site_ids: siteIds }, now);
  const r = pulse.result;
  const tiles: Tile[] = r.table.map((row: PulseRow) => {
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
  });
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

/** Failed-item Pareto by item (normalised label within template), from the core failed-items analytic. */
export function topFailedItems(cache: CacheReader, period: string, siteIds: string[] | undefined, top: number, now: Date) {
  const { result } = analyzeFailedItems(cache, { period, site_ids: siteIds, group_by: "item", top }, now);
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
  return { rows, totalFailed: Number(result.metrics.failed_items ?? 0), totalAnswered: Number(result.metrics.answered_items ?? 0) };
}

export interface OverdueRow {
  id: string;
  title: string;
  site: string;
  priority: string;
  due: string;
  days_overdue: number;
}

/** Open actions due before now (core loadActions + isOverdue), most overdue first. */
export function overdueActions(cache: CacheReader, siteIds: string[] | undefined, now: Date): OverdueRow[] {
  const t = now.getTime();
  const names = siteNameMap(cache);
  return loadActions(cache, { site_ids: siteIds })
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
}

/** Core action backlog for the scope; resolution and flow over the period. */
export function backlogSummary(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  return analyzeActionBacklog(cache, { period, site_ids: siteIds }, now).result;
}

/** Core schedule compliance. `metrics.due` is null when the occurrences feed is empty (no scheduling data). */
export function scheduleSummary(cache: CacheReader, period: string, siteIds: string[] | undefined, now: Date) {
  return analyzeScheduleCompliance(cache, { period, site_ids: siteIds }, now).result;
}

export function coverageTable(cache: CacheReader, feeds: FeedName[]): Cell[][] {
  return coverage(cache, feeds).map((c) => [c.feed, c.rows, c.last_synced_at ?? "never synced", c.complete ? "complete" : c.last_synced_at ? "partial (row cap)" : "missing"]);
}
