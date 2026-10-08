import { createHash } from "node:crypto";
import type { CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { previousPeriod, type Period } from "../core/time.js";
import { coverage, groupBy, nameMaps, str } from "../analytics/common.js";
import { median, pct, round } from "../analytics/stats.js";
import {
  DAY_MS,
  actionPriority,
  completedInspections,
  inScope,
  inWindow,
  isOpenAction,
  isoDay,
  itemsByInspection,
  isAnswered,
  isFailed,
  measurer,
  siteKey,
  siteSet,
  templateKey,
  toTime,
  type ScopeFilter,
  type TrendMetric,
} from "../analytics/trend.js";
import type { Cell, Tile } from "./model.js";

/**
 * Data sections shared by the reports.
 *
 * TODO(W6 core analytics): the core analytics modules (pulse, failed-items, backlog,
 * schedule-compliance) are built by another ticket and are not present in this worktree. These
 * sections compute the same figures from the shared helpers; once the core modules land, swap
 * kpiTiles -> pulse, topFailedItems -> failed-items, backlogSummary -> backlog and
 * scheduleSummary -> schedule-compliance so every surface uses one definition.
 */

export const MIN_DELTA_N = 20;
const DAY = DAY_MS;

export function orgFingerprint(cache: CacheReader): string {
  for (const feed of ["inspections", "sites", "users", "templates", "actions", "issues"] as FeedName[]) {
    const r = cache.rows(feed).find((x) => str(x.organisation_id));
    if (r) return createHash("sha256").update(String(r.organisation_id)).digest("hex").slice(0, 10);
  }
  return "unknown";
}

const win = (p: Period) => ({ from: p.from.getTime(), to: p.to.getTime() });

/** KPI tiles for a period with deltas vs the previous equal period (only when both have >= 20 observations). */
export function kpiTiles(cache: CacheReader, period: Period, scope: ScopeFilter, now: Date) {
  const prev = previousPeriod(period);
  const tile = (metric: TrendMetric, label: string, unit: string, good?: "up" | "down"): Tile & { n: number; prevN: number } => {
    const m = measurer(cache, metric, scope);
    const c = m.measure(period.from.getTime(), period.to.getTime());
    const p = m.measure(prev.from.getTime(), prev.to.getTime());
    const enough = c.n >= MIN_DELTA_N && p.n >= MIN_DELTA_N && c.value !== null && p.value !== null;
    return {
      label,
      value: c.value,
      unit,
      previous: p.value,
      delta: enough ? round((c.value as number) - (p.value as number), 1) : null,
      note: enough ? undefined : `too few to compare (${c.n} vs ${p.n} observations; needs ${MIN_DELTA_N} each)`,
      good,
      n: c.n,
      prevN: p.n,
    };
  };
  const overdue = overdueActions(cache, scope, now);
  const tiles = [
    tile("inspections_completed", "Inspections completed", "", "up"),
    tile("average_score", "Average score", "%", "up"),
    tile("failed_item_rate", "Failed-item rate", "%", "down"),
    tile("issues_created", "Issues reported", ""),
    tile("actions_created", "Actions created", ""),
    tile("actions_completed", "Actions completed", "", "up"),
  ];
  const overdueTile: Tile = {
    label: "Open overdue actions",
    value: overdue.length,
    note: overdue.length ? `oldest ${overdue[0]!.days_overdue} days overdue (snapshot now)` : "snapshot now",
  };
  return { tiles: [...tiles, overdueTile] as Tile[], raw: tiles, overdue };
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

/** Failed-item Pareto: identity = normalised label within template. */
export function topFailedItems(cache: CacheReader, period: Period, scope: ScopeFilter, limit: number): { rows: FailedItemRow[]; totalFailed: number; totalAnswered: number } {
  const insps = completedInspections(cache, win(period), scope);
  const byKey = new Map(insps.map((i) => [i.key, i]));
  const items = itemsByInspection(cache, new Set(byKey.keys()));
  const acc = new Map<string, { template: string; label: string; failed: number; answered: number; examples: string[] }>();
  let totalFailed = 0;
  let totalAnswered = 0;
  for (const [k, arr] of items) {
    const insp = byKey.get(k)!;
    for (const it of arr) {
      if (!isAnswered(it)) continue;
      totalAnswered++;
      const key = `${insp.templateKey ?? ""}\u0000${it.labelKey}`;
      let a = acc.get(key);
      if (!a) {
        a = { template: insp.templateName ?? insp.templateId ?? "(unknown template)", label: it.label.trim() || "(no label)", failed: 0, answered: 0, examples: [] };
        acc.set(key, a);
      }
      a.answered++;
      if (isFailed(it)) {
        a.failed++;
        totalFailed++;
        if (a.examples.length < 3 && !a.examples.includes(insp.id)) a.examples.push(insp.id);
      }
    }
  }
  const sorted = [...acc.values()].filter((a) => a.failed > 0).sort((a, b) => b.failed - a.failed || a.label.localeCompare(b.label) || a.template.localeCompare(b.template));
  let cum = 0;
  const rows = sorted.slice(0, limit).map((a) => {
    cum += a.failed;
    return { ...a, failure_rate: pct(a.failed, a.answered, 1), share: pct(a.failed, totalFailed, 1), cumulative_share: pct(cum, totalFailed, 1) };
  });
  return { rows, totalFailed, totalAnswered };
}

export interface OverdueRow {
  id: string;
  title: string;
  site: string;
  priority: string;
  due: string;
  days_overdue: number;
}

export function overdueActions(cache: CacheReader, scope: ScopeFilter, now: Date): OverdueRow[] {
  const sites = siteSet(scope.site_ids);
  const siteNames = siteNameMap(cache);
  const out: OverdueRow[] = [];
  for (const r of cache.rows("actions")) {
    if (!inScope(r, sites) || !isOpenAction(r)) continue;
    const due = toTime(r.due_date);
    if (due === undefined || due >= now.getTime()) continue;
    out.push({
      id: String(r.id),
      title: str(r.title) ?? "(untitled action)",
      site: siteNames.get(siteKey(r.site_id) ?? "") ?? (str(r.site_id) ? String(r.site_id) : "(no site)"),
      priority: actionPriority(r.priority),
      due: isoDay(due),
      days_overdue: Math.floor((now.getTime() - due) / DAY),
    });
  }
  return out.sort((a, b) => b.days_overdue - a.days_overdue || a.id.localeCompare(b.id));
}

export function siteNameMap(cache: CacheReader): Map<string, string> {
  return new Map([...nameMaps(cache).sites.entries()].map(([id, n]) => [siteKey(id)!, n]));
}

export interface OpenActionRow {
  id: string;
  title: string;
  priority: string;
  age_days: number;
  due: string | null;
  days_overdue: number | null;
}

export function backlogSummary(cache: CacheReader, period: Period, scope: ScopeFilter, now: Date) {
  const sites = siteSet(scope.site_ids);
  const rows = cache.rows("actions").filter((r) => inScope(r, sites));
  const open = rows.filter(isOpenAction);
  const ageing = { "0-7 days": 0, "8-30 days": 0, "31-90 days": 0, "90+ days": 0 };
  let noDue = 0;
  let overdue = 0;
  const openRows: OpenActionRow[] = [];
  for (const r of open) {
    const created = toTime(r.created_at);
    const due = toTime(r.due_date);
    if (due === undefined) noDue++;
    else if (due < now.getTime()) overdue++;
    if (created === undefined) continue;
    const age = Math.floor((now.getTime() - created) / DAY);
    if (age <= 7) ageing["0-7 days"]++;
    else if (age <= 30) ageing["8-30 days"]++;
    else if (age <= 90) ageing["31-90 days"]++;
    else ageing["90+ days"]++;
    openRows.push({
      id: String(r.id),
      title: str(r.title) ?? "(untitled action)",
      priority: actionPriority(r.priority),
      age_days: age,
      due: due !== undefined ? isoDay(due) : null,
      days_overdue: due !== undefined && due < now.getTime() ? Math.floor((now.getTime() - due) / DAY) : null,
    });
  }
  openRows.sort((a, b) => (b.days_overdue ?? -1) - (a.days_overdue ?? -1) || b.age_days - a.age_days || a.id.localeCompare(b.id));
  const w = win(period);
  const created = rows.filter((r) => inWindow(toTime(r.created_at), w.from, w.to)).length;
  const completedRows = rows.filter((r) => inWindow(toTime(r.completed_at), w.from, w.to));
  const resolution = completedRows
    .map((r) => {
      const c = toTime(r.created_at);
      const d = toTime(r.completed_at);
      return c !== undefined && d !== undefined && d >= c ? (d - c) / DAY : undefined;
    })
    .filter((x): x is number => x !== undefined);
  return {
    open: open.length,
    overdue,
    no_due_date: noDue,
    ageing,
    created_in_period: created,
    completed_in_period: completedRows.length,
    median_resolution_days: resolution.length ? round(median(resolution), 1) : null,
    openRows,
  };
}

export const OCCURRENCE_STATUSES = ["COMPLETED", "LATE", "MISSED", "WONT_DO", "OVERDUE", "IN_PROGRESS", "TODO"] as const;

/** Schedule occurrences due in the period, by occurrence_status. Null when the feed has no rows. */
export function scheduleSummary(cache: CacheReader, period: Period) {
  const all = cache.rows("schedule_occurrences");
  if (!all.length) return null;
  const w = win(period);
  const due = all.filter((r) => inWindow(toTime(r.due_time), w.from, w.to));
  const counts: Record<string, number> = Object.fromEntries(OCCURRENCE_STATUSES.map((s) => [s, 0]));
  for (const r of due) {
    const s = (str(r.occurrence_status) ?? "UNKNOWN").toUpperCase();
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const resolved = counts.COMPLETED! + counts.LATE! + counts.MISSED!;
  const missedByTemplate = groupBy(
    due.filter((r) => (str(r.occurrence_status) ?? "").toUpperCase() === "MISSED"),
    (r) => templateKey(r.template_id) ?? "",
  );
  return {
    due: due.length,
    counts,
    on_time_pct: pct(counts.COMPLETED!, resolved, 1),
    late_pct: pct(counts.LATE!, resolved, 1),
    missed_pct: pct(counts.MISSED!, resolved, 1),
    missedByTemplate,
  };
}

/** Per-template failed-item rate jumps of >= 10 percentage points vs the previous period (>= 20 answered both). */
export function failedRateJumps(cache: CacheReader, period: Period, scope: ScopeFilter) {
  const prev = previousPeriod(period);
  const rates = (p: Period) => {
    const insps = completedInspections(cache, win(p), scope);
    const items = itemsByInspection(cache, new Set(insps.map((i) => i.key)));
    const m = new Map<string, { name: string; answered: number; failed: number }>();
    for (const i of insps) {
      const t = m.get(i.templateKey ?? "") ?? { name: i.templateName ?? i.templateId ?? "(unknown template)", answered: 0, failed: 0 };
      for (const it of items.get(i.key) ?? []) {
        if (isAnswered(it)) t.answered++;
        if (isFailed(it)) t.failed++;
      }
      m.set(i.templateKey ?? "", t);
    }
    return m;
  };
  const cur = rates(period);
  const before = rates(prev);
  const out: Array<{ template: string; now: number; before: number; jump_pp: number }> = [];
  for (const [k, c] of cur) {
    const b = before.get(k);
    if (!b || c.answered < MIN_DELTA_N || b.answered < MIN_DELTA_N) continue;
    const n = pct(c.failed, c.answered, 1)!;
    const p = pct(b.failed, b.answered, 1)!;
    const jump = round(n - p, 1)!;
    if (jump >= 10) out.push({ template: c.name, now: n, before: p, jump_pp: jump });
  }
  return out.sort((a, b) => b.jump_pp - a.jump_pp);
}

/**
 * Attention list, in severity order: overdue high-priority actions > missed scheduled
 * inspections by template > failed-item rate jumps of >= 10 pp > new high-priority issues.
 */
export function attentionList(cache: CacheReader, period: Period, scope: ScopeFilter, now: Date, max = 5): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  for (const a of overdueActions(cache, scope, now).filter((a) => a.priority === "high"))
    out.push({ text: `High-priority action "${a.title}" at ${a.site} is ${a.days_overdue} days overdue.`, href: links.action(a.id) });
  const sched = scope.site_ids?.length ? null : scheduleSummary(cache, period);
  if (sched) {
    const tplNames = new Map([...nameMaps(cache).templates.entries()].map(([id, n]) => [templateKey(id)!, n]));
    for (const [t, rows] of [...sched.missedByTemplate.entries()].sort((a, b) => b[1].length - a[1].length))
      out.push({ text: `${rows.length} missed scheduled inspection${rows.length === 1 ? "" : "s"} of ${tplNames.get(t) ?? (t || "an unknown template")}.` });
  }
  for (const j of failedRateJumps(cache, period, scope)) out.push({ text: `Failed-item rate on "${j.template}" rose ${j.jump_pp} pp (${j.before}% to ${j.now}%).` });
  const sites = siteSet(scope.site_ids);
  const w = win(period);
  for (const r of cache.rows("issues")) {
    if (!inScope(r, sites) || actionPriority(r.priority) !== "high" || !inWindow(toTime(r.created_at), w.from, w.to)) continue;
    out.push({ text: `New high-priority issue "${str(r.title) ?? "(untitled)"}"${str(r.site_name) ? ` at ${str(r.site_name)}` : ""}.`, href: links.issue(String(r.id)) });
  }
  return out.slice(0, max);
}

export function coverageTable(cache: CacheReader, feeds: FeedName[]): Cell[][] {
  return coverage(cache, feeds).map((c) => [c.feed, c.rows, c.last_synced_at ?? "never synced", c.complete ? "complete" : c.last_synced_at ? "partial (row cap)" : "missing"]);
}
