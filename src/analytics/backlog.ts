import type { AnalyticResult, CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, type Period } from "../core/time.js";
import { ACTION_PRIORITY, ACTION_STATUS } from "../toolsets/actions.js";
import { buildResult, feedProblem, nameMaps, str, unavailableSentence } from "./common.js";
import { canon, DAY, idIn } from "./failed-items.js";
import { median, quantile, round } from "./stats.js";

/**
 * Action helpers shared by the core analytics, plus the action backlog analytic.
 *
 * Feed fields relied on (api-ref thepubservice_feedactions / _feedactionassignees, docs/api-shapes.md):
 *   actions: id, title, site_id, priority, status, due_date, created_at, completed_at, template_id, audit_id, action_label
 *   action_assignees: action_id, assignee_id, name, type
 * The actions feed documents `priority` and `status` only as strings; both the display names ("High",
 * "To do", "Can't do") and the system UUIDs are accepted.
 */

export type ActionStatus = "to_do" | "in_progress" | "complete" | "cant_do" | "unknown";
export type Priority = "high" | "medium" | "low" | "none" | "other";

export interface Action {
  id: string;
  title?: string;
  site_id?: string;
  priority: Priority;
  status: ActionStatus;
  open: boolean;
  created_ms?: number;
  due_ms?: number;
  completed_ms?: number;
  labels: string[];
}

const STATUS_BY_ID = new Map<string, ActionStatus>(Object.entries(ACTION_STATUS).map(([k, v]) => [v, k as ActionStatus]));
const PRIORITY_BY_ID = new Map<string, Priority>(Object.entries(ACTION_PRIORITY).map(([k, v]) => [v, k as Priority]));

export function normStatus(v: unknown): ActionStatus {
  const raw = String(v ?? "").trim();
  const byId = STATUS_BY_ID.get(raw.toLowerCase());
  if (byId) return byId;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "todo" || s === "open") return "to_do";
  if (s === "inprogress") return "in_progress";
  if (s === "complete" || s === "completed" || s === "done" || s === "closed") return "complete";
  if (s === "cantdo" || s === "cannotdo" || s === "wontdo") return "cant_do";
  return "unknown";
}

export function normPriority(v: unknown): Priority {
  const raw = String(v ?? "").trim();
  if (!raw) return "none";
  const byId = PRIORITY_BY_ID.get(raw.toLowerCase());
  if (byId) return byId;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "high" || s === "medium" || s === "low" || s === "none") return s;
  return "other";
}

/** action_label is pipe-delimited, e.g. {"label_id":"..."|"label_name":"Housekeeping"}. Returns label names. */
export function parseLabels(v: unknown): string[] {
  const s = str(v);
  if (!s || !s.trim()) return [];
  const names = [...s.matchAll(/"?label_name"?\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"').trim()).filter(Boolean);
  if (names.length) return names;
  return s
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

const ms = (v: unknown) => {
  const s = str(v);
  if (!s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
};

export function toAction(r: Record<string, unknown>): Action {
  const status = normStatus(r.status);
  const completed = ms(r.completed_at);
  return {
    id: String(r.id),
    title: str(r.title),
    site_id: str(r.site_id) || undefined,
    priority: normPriority(r.priority),
    status,
    // Status decides; only an unrecognised status falls back to "no completion date = open".
    open: status === "to_do" || status === "in_progress" ? true : status === "unknown" ? completed === undefined : false,
    created_ms: ms(r.created_at),
    due_ms: ms(r.due_date),
    completed_ms: completed,
    labels: parseLabels(r.action_label),
  };
}

export interface ActionFilters {
  site_ids?: string[];
  priority?: Priority[];
}

export function loadActions(cache: CacheReader, f: ActionFilters = {}): Action[] {
  return cache
    .rows("actions")
    .map(toAction)
    .filter((a) => idIn(a.site_id, f.site_ids) && (!f.priority?.length || f.priority.includes(a.priority)));
}

/** Open and past due at `at` (strictly: due exactly at `at` is not yet overdue). */
export const isOverdue = (a: Action, at: number) => a.open && a.due_ms !== undefined && a.due_ms < at;

/** Actions that count as completed for resolution time: status complete (or unrecognised with a completion date). */
export const isResolved = (a: Action) => a.completed_ms !== undefined && (a.status === "complete" || a.status === "unknown");

/** Resolution days (created -> completed) for actions completed inside the period. Negative spans are dropped. */
export function resolutionDays(actions: Action[], p: Period): { days: number[]; dropped: number } {
  const days: number[] = [];
  let dropped = 0;
  for (const a of actions) {
    if (!isResolved(a) || a.completed_ms! < p.from.getTime() || a.completed_ms! >= p.to.getTime()) continue;
    if (a.created_ms === undefined || a.completed_ms! < a.created_ms) {
      dropped++;
      continue;
    }
    days.push((a.completed_ms! - a.created_ms) / DAY);
  }
  return { days, dropped };
}

/**
 * Open-and-overdue count as it stood at time `t`, reconstructed from timestamps: created before t, not completed
 * by t (an action closed without a completion date is treated as closed), due before t.
 */
export function overdueAt(actions: Action[], t: number): Action[] {
  return actions.filter((a) => {
    if (a.created_ms === undefined || a.created_ms > t) return false;
    if (a.due_ms === undefined || a.due_ms >= t) return false;
    if (a.completed_ms !== undefined) return a.completed_ms > t;
    return a.open;
  });
}

export const BUCKETS = ["0-7", "8-30", "31-90", "90+"] as const;
export type Bucket = (typeof BUCKETS)[number];
/** Whole days (floored): 0-7, 8-30, 31-90, 91 and over. */
export const bucketOf = (days: number): Bucket => (days <= 7 ? "0-7" : days <= 30 ? "8-30" : days <= 90 ? "31-90" : "90+");
export const wholeDays = (fromMs: number, toMs: number) => Math.floor((toMs - fromMs) / DAY);

export const BACKLOG_VERSION = "action-backlog/1";

const BACKLOG_METRICS = [
  "open",
  "overdue",
  "open_no_due_date",
  "age_0_7",
  "age_8_30",
  "age_31_90",
  "age_90_plus",
  "overdue_0_7",
  "overdue_8_30",
  "overdue_31_90",
  "overdue_90_plus",
  "completed_in_period",
  "median_resolution_days",
  "p90_resolution_days",
  "opened_in_period",
  "closed_in_period",
] as const;

export interface BacklogArgs {
  site_ids?: string[];
  priority?: Array<"high" | "medium" | "low" | "none">;
  group_by?: "site" | "assignee" | "priority" | "label";
  overdue_only?: boolean;
  period?: string;
}

export interface BacklogRow {
  group: string;
  /** "person" when grouped by assignee, so strict privacy pseudonymises the group name. */
  group_kind: string;
  key: string;
  open: number;
  overdue: number;
  no_due_date: number;
  age_0_7: number;
  age_8_30: number;
  age_31_90: number;
  age_90_plus: number;
  oldest_age_days: number | null;
}

const bucketField = { "0-7": "age_0_7", "8-30": "age_8_30", "31-90": "age_31_90", "90+": "age_90_plus" } as const;

export function analyzeActionBacklog(
  cache: CacheReader,
  args: BacklogArgs,
  now: Date,
): {
  summary: string;
  result: AnalyticResult<BacklogRow> & {
    weekly: Array<{ week_start: string; opened: number; closed: number }>;
    oldest_open: Array<Record<string, unknown>>;
  };
} {
  const period = parsePeriod(args.period, now, "last 90 days");
  const groupBy = args.group_by ?? "site";
  const t = now.getTime();
  const feeds: FeedName[] = groupBy === "assignee" ? ["actions", "action_assignees"] : ["actions"];
  const filters = { site_ids: args.site_ids, priority: args.priority, group_by: groupBy, overdue_only: args.overdue_only || undefined };

  // An unreadable actions feed is missing data, not an empty backlog: every figure is null.
  const problem = feedProblem(cache, "actions");
  if (problem) {
    const result = buildResult<BacklogRow>({
      version: BACKLOG_VERSION,
      period,
      filters,
      cache,
      feeds,
      metrics: Object.fromEntries(BACKLOG_METRICS.map((k) => [k, null])),
      table: [],
      method: "The action backlog needs the actions feed; it could not be read, so no figures are computed.",
      caveats: [`No action figures: ${problem}. This is not an empty backlog.`],
      now,
    });
    return { summary: unavailableSentence("Action figures", problem), result: { ...result, weekly: [], oldest_open: [] } };
  }
  const names = nameMaps(cache);
  const actions = loadActions(cache, { site_ids: args.site_ids, priority: args.priority });
  let open = actions.filter((a) => a.open);
  if (args.overdue_only) open = open.filter((a) => isOverdue(a, t));

  const ageBuckets: Record<Bucket, number> = { "0-7": 0, "8-30": 0, "31-90": 0, "90+": 0 };
  const overdueBuckets: Record<Bucket, number> = { "0-7": 0, "8-30": 0, "31-90": 0, "90+": 0 };
  let overdue = 0;
  let noDue = 0;
  let noCreated = 0;
  for (const a of open) {
    if (a.created_ms === undefined) noCreated++;
    else ageBuckets[bucketOf(wholeDays(a.created_ms, t))]++;
    if (a.due_ms === undefined) noDue++;
    else if (isOverdue(a, t)) {
      overdue++;
      overdueBuckets[bucketOf(wholeDays(a.due_ms, t))]++;
    }
  }

  // Group table. Assignee and label groupings can place one action in several groups. An unreadable
  // assignees feed withholds the assignee table: every action would otherwise read as "(unassigned)".
  const noAssignees = groupBy === "assignee" ? feedProblem(cache, "action_assignees") : null;
  const assignees = new Map<string, Array<{ key: string; name: string }>>();
  if (groupBy === "assignee") {
    for (const r of cache.rows("action_assignees")) {
      const k = canon(r.action_id);
      const list = assignees.get(k) ?? [];
      const id = String(r.assignee_id ?? "");
      list.push({ key: canon(id) || "(unknown)", name: str(r.name) || names.users.get(id) || id || "(unknown)" });
      assignees.set(k, list);
    }
  }
  const keysOf = (a: Action): Array<{ key: string; name: string }> => {
    if (groupBy === "priority") return [{ key: a.priority, name: a.priority }];
    if (groupBy === "label") return a.labels.length ? a.labels.map((l) => ({ key: l.toLowerCase(), name: l })) : [{ key: "(no label)", name: "(no label)" }];
    if (groupBy === "assignee") return assignees.get(canon(a.id)) ?? [{ key: "(unassigned)", name: "(unassigned)" }];
    return a.site_id ? [{ key: canon(a.site_id), name: names.sites.get(a.site_id) ?? a.site_id }] : [{ key: "(no site)", name: "(no site)" }];
  };
  const groups = new Map<string, BacklogRow>();
  for (const a of noAssignees ? [] : open) {
    const seen = new Set<string>();
    for (const { key, name } of keysOf(a)) {
      if (seen.has(key)) continue;
      seen.add(key);
      let g = groups.get(key);
      if (!g) {
        g = { group: name, group_kind: groupBy === "assignee" ? "person" : groupBy, key, open: 0, overdue: 0, no_due_date: 0, age_0_7: 0, age_8_30: 0, age_31_90: 0, age_90_plus: 0, oldest_age_days: null };
        groups.set(key, g);
      }
      g.open++;
      if (a.due_ms === undefined) g.no_due_date++;
      else if (isOverdue(a, t)) g.overdue++;
      if (a.created_ms !== undefined) {
        const age = wholeDays(a.created_ms, t);
        g[bucketField[bucketOf(age)]]++;
        g.oldest_age_days = g.oldest_age_days === null ? age : Math.max(g.oldest_age_days, age);
      }
    }
  }
  const table = [...groups.values()].sort((x, y) => y.overdue - x.overdue || y.open - x.open || x.group.localeCompare(y.group));

  // Resolution and flow (period-based, ignores overdue_only).
  const res = resolutionDays(actions, period);
  const weekly: Array<{ week_start: string; opened: number; closed: number }> = [];
  const pf = period.from.getTime();
  const firstMonday = pf - ((new Date(pf).getUTCDay() + 6) % 7) * DAY - (pf % DAY);
  for (let w = firstMonday; w < period.to.getTime(); w += 7 * DAY) {
    const lo = Math.max(w, pf);
    const hi = Math.min(w + 7 * DAY, period.to.getTime());
    weekly.push({
      week_start: new Date(w).toISOString().slice(0, 10),
      opened: actions.filter((a) => a.created_ms !== undefined && a.created_ms >= lo && a.created_ms < hi).length,
      closed: actions.filter((a) => a.completed_ms !== undefined && a.completed_ms >= lo && a.completed_ms < hi).length,
    });
  }
  const openedInPeriod = weekly.reduce((s, w) => s + w.opened, 0);
  const closedInPeriod = weekly.reduce((s, w) => s + w.closed, 0);

  const oldest = open
    .filter((a) => a.created_ms !== undefined)
    .sort((x, y) => x.created_ms! - y.created_ms! || x.id.localeCompare(y.id))
    .slice(0, 10)
    .map((a) => ({
      id: a.id,
      title: a.title,
      site: a.site_id ? (names.sites.get(a.site_id) ?? a.site_id) : undefined,
      priority: a.priority,
      status: a.status,
      age_days: wholeDays(a.created_ms!, t),
      due_date: a.due_ms !== undefined ? new Date(a.due_ms).toISOString() : null,
      overdue_days: a.due_ms !== undefined && isOverdue(a, t) ? wholeDays(a.due_ms, t) : null,
      link: links.action(a.id),
    }));

  const unknownStatus = actions.filter((a) => a.status === "unknown").length;
  const caveats: string[] = [];
  if (unknownStatus) caveats.push(`${unknownStatus} actions have an unrecognised status; they were treated as open unless they carry a completion date.`);
  if (noCreated) caveats.push(`${noCreated} open actions have no created date and are left out of the ageing buckets.`);
  if (res.dropped) caveats.push(`${res.dropped} completed actions were left out of resolution times (missing created date or completed before created).`);
  if (groupBy === "assignee" || groupBy === "label") caveats.push(`An action with several ${groupBy}s is counted in each of their groups, so group totals can exceed ${open.length}.`);
  if (groupBy === "assignee") caveats.push("Group assignees are shown as the group, not expanded to members.");
  if (noAssignees) caveats.push(`No assignee grouping: ${noAssignees}. The group table is withheld; this does not mean the actions are unassigned.`);
  caveats.push("Weekly buckets start on Monday (UTC); the first and last weeks can be partial.");

  const med = round(median(res.days), 1);
  const p90 = round(quantile(res.days, 0.9), 1);
  const result = buildResult({
    version: BACKLOG_VERSION,
    period,
    filters,
    cache,
    feeds,
    metrics: {
      open: open.length,
      overdue,
      open_no_due_date: noDue,
      age_0_7: ageBuckets["0-7"],
      age_8_30: ageBuckets["8-30"],
      age_31_90: ageBuckets["31-90"],
      age_90_plus: ageBuckets["90+"],
      overdue_0_7: overdueBuckets["0-7"],
      overdue_8_30: overdueBuckets["8-30"],
      overdue_31_90: overdueBuckets["31-90"],
      overdue_90_plus: overdueBuckets["90+"],
      completed_in_period: res.days.length,
      median_resolution_days: med,
      p90_resolution_days: p90,
      opened_in_period: openedInPeriod,
      closed_in_period: closedInPeriod,
    },
    table,
    method:
      "Open = status To do or In progress. Age = whole days since created; overdue = due date before now, in whole days past due. Resolution = created to completed for actions completed in the period (median and 90th percentile, type-7 interpolation).",
    caveats,
    now,
  });
  const summary =
    `${open.length} open actions${args.overdue_only ? " (overdue only)" : ""}: ${overdue} overdue, ${noDue} with no due date, ${ageBuckets["90+"]} older than 90 days. ` +
    `${res.days.length} completed ${period.label} with median resolution ${med ?? "n/a"} days (p90 ${p90 ?? "n/a"}); ${openedInPeriod} opened vs ${closedInPeriod} closed.` +
    (noAssignees ? ` ${unavailableSentence("Assignee grouping", noAssignees)}` : "");
  return { summary, result: { ...result, weekly, oldest_open: oldest } };
}
