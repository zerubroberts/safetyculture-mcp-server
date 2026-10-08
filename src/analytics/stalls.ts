import type { CacheReader } from "../cache/contract.js";
import { links } from "../core/params.js";
import type { Period } from "../core/time.js";
import { buildResult, groupBy, str } from "./common.js";
import { median, round, sum } from "./stats.js";
import { CLOSED_STATUSES, DAY_MS, actionPriority, actionStatus, inWindow, isOpenAction, siteSet, siteKey, toTime, uuidKey } from "./trend.js";

/**
 * Where actions stall, from the action timeline feed.
 *
 * action_timeline_items fields: task_id, timestamp, item_type, item_data. The feed documents
 * item_type only as "Type of a timeline item"; the values used here follow the tasks timeline
 * enum (POST /tasks/v1/timeline): TASK_CREATED, TASK_STATUS_UPDATED, TASK_DUE_AT_UPDATED,
 * TASK_ASSIGNEE_ADDED / _REMOVED / _UPDATED. Matching is case-insensitive on the words STATUS,
 * DUE and ASSIGNEE so a lower-case or unprefixed feed value still counts. item_data is a string,
 * parsed as JSON when possible; the new status is read from a status_id (system status UUID) or
 * status / status_label / label field anywhere in it.
 */

/** Changes within this long of creation are the initial set-up, not re-assignments or re-dates. */
export const SETUP_GRACE_MS = 60_000;

export interface StallArgs {
  action_ids?: string[];
  site_ids?: string[];
  priority?: string[];
  period?: Period;
  limit: number;
}

export interface StallRow {
  action_id: string;
  ref?: string;
  title?: string;
  status?: string;
  open: boolean;
  priority: string;
  created_at?: string;
  days_open: number;
  days_in_status: Record<string, number>;
  longest_gap_days: number;
  longest_gap_from?: string;
  longest_gap_to?: string;
  status_changes: number;
  due_date_changes: number;
  reassignments: number;
  timeline_events: number;
  link: string;
}

function findKey(v: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > 6 || v === null || v === undefined) return undefined;
  if (typeof v !== "object") return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = findKey(x, keys, depth + 1);
      if (r) return r;
    }
    return undefined;
  }
  const o = v as Record<string, unknown>;
  for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  for (const x of Object.values(o)) {
    const r = findKey(x, keys, depth + 1);
    if (r) return r;
  }
  return undefined;
}

const KNOWN_STATUSES = new Set(["to_do", "in_progress", "complete", "cant_do"]);
const known = (v: string | undefined) => {
  const s = v ? actionStatus(v) : undefined;
  return s && KNOWN_STATUSES.has(s) ? s : undefined;
};

/**
 * New status carried by a status-change timeline item, or undefined when it cannot be read as
 * one of the four system statuses (custom statuses count as "unknown").
 */
export function statusFromItemData(data: unknown): string | undefined {
  const raw = str(data);
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return known(raw);
  }
  if (typeof parsed === "string") return known(parsed);
  return known(findKey(parsed, ["status_id", "new_status_id"])) ?? known(findKey(parsed, ["status", "status_label", "label", "key"]));
}

const kindOf = (t: unknown) => {
  const s = (str(t) ?? "").toUpperCase();
  if (s.includes("STATUS")) return "status";
  if (s.includes("DUE")) return "due";
  if (s.includes("ASSIGNEE")) return "assignee";
  return "other";
};

export function computeStalls(cache: CacheReader, args: StallArgs, now: Date) {
  const nowMs = now.getTime();
  const wanted = args.action_ids?.length ? new Set(args.action_ids.map((a) => uuidKey(a)!)) : undefined;
  const sites = siteSet(args.site_ids);
  const prios = args.priority?.length ? new Set(args.priority) : undefined;
  const actions = cache.rows("actions").filter((r) => {
    if (wanted && !wanted.has(uuidKey(r.id) ?? "")) return false;
    if (sites && !sites.has(siteKey(r.site_id) ?? "")) return false;
    if (prios && !prios.has(actionPriority(r.priority))) return false;
    if (args.period && !inWindow(toTime(r.created_at), args.period.from.getTime(), args.period.to.getTime())) return false;
    return true;
  });
  const timeline = groupBy(cache.rows("action_timeline_items"), (r) => uuidKey(r.task_id) ?? "");

  const rows: StallRow[] = [];
  const unreadable = { status: 0 };
  let noTimeline = 0;
  for (const a of actions) {
    const created = toTime(a.created_at);
    if (created === undefined) continue;
    const current = actionStatus(a.status);
    const closed = !isOpenAction(a);
    const events = (timeline.get(uuidKey(a.id) ?? "") ?? [])
      .map((e) => ({ t: toTime(e.timestamp), kind: kindOf(e.item_type), data: e.item_data }))
      .filter((e): e is { t: number; kind: string; data: unknown } => e.t !== undefined)
      .sort((x, y) => x.t - y.t);
    if (!events.length) noTimeline++;
    const lastEvent = events.length ? events[events.length - 1]!.t : created;
    const end = closed ? Math.max(toTime(a.completed_at) ?? toTime(a.modified_at) ?? lastEvent, created) : nowMs;

    // Time in status: starts "to_do" at creation, switches at each readable status change.
    const inStatus: Record<string, number> = {};
    let status = "to_do";
    let since = created;
    let statusChanges = 0;
    let stopped = false;
    for (const e of events) {
      if (e.kind !== "status") continue;
      statusChanges++;
      const next = statusFromItemData(e.data) ?? "unknown";
      if (next === "unknown") unreadable.status++;
      const t = Math.min(Math.max(e.t, since), end);
      if (!CLOSED_STATUSES.has(status)) inStatus[status] = (inStatus[status] ?? 0) + (t - since);
      status = next;
      since = t;
      if (t >= end) {
        stopped = true;
        break;
      }
    }
    if (!stopped && !CLOSED_STATUSES.has(status)) inStatus[status] = (inStatus[status] ?? 0) + Math.max(0, end - since);

    // Longest stretch without any timeline activity, from creation to completion (or now if open).
    const marks = [created, ...events.map((e) => e.t).filter((t) => t >= created && t <= end), end];
    let gap = 0;
    let gapFrom = created;
    let gapTo = created;
    for (let i = 1; i < marks.length; i++) {
      const d = marks[i]! - marks[i - 1]!;
      if (d > gap) {
        gap = d;
        gapFrom = marks[i - 1]!;
        gapTo = marks[i]!;
      }
    }
    const afterSetup = (e: { t: number }) => e.t - created > SETUP_GRACE_MS;
    rows.push({
      action_id: String(a.id),
      ref: str(a.unique_id),
      title: str(a.title),
      status: current,
      open: !closed,
      priority: actionPriority(a.priority),
      created_at: new Date(created).toISOString(),
      days_open: round((end - created) / DAY_MS, 1)!,
      days_in_status: Object.fromEntries(Object.entries(inStatus).map(([k, v]) => [k, round(v / DAY_MS, 1)!])),
      longest_gap_days: round(gap / DAY_MS, 1)!,
      longest_gap_from: new Date(gapFrom).toISOString(),
      longest_gap_to: new Date(gapTo).toISOString(),
      status_changes: statusChanges,
      due_date_changes: events.filter((e) => e.kind === "due" && afterSetup(e)).length,
      reassignments: events.filter((e) => e.kind === "assignee" && afterSetup(e)).length,
      timeline_events: events.length,
      link: links.action(String(a.id)),
    });
  }

  // Aggregate: where the open time goes, by status.
  const statusNames = [...new Set(rows.flatMap((r) => Object.keys(r.days_in_status)))];
  const totalDays = sum(rows.flatMap((r) => Object.values(r.days_in_status)));
  const by_status = statusNames
    .map((s) => {
      const per = rows.map((r) => r.days_in_status[s]).filter((d): d is number => d !== undefined);
      const total = round(sum(per), 1)!;
      return { status: s, actions: per.length, total_days: total, median_days: round(median(per), 1), share_of_open_time_pct: totalDays > 0 ? round((100 * sum(per)) / totalDays, 1) : null };
    })
    .sort((a, b) => b.total_days - a.total_days);

  rows.sort((a, b) => b.longest_gap_days - a.longest_gap_days || a.action_id.localeCompare(b.action_id));
  const caveats: string[] = [
    'Every action is assumed to start in "to_do" at creation; time before the first status change counts there.',
    `Due-date changes and reassignments within ${SETUP_GRACE_MS / 1000}s of creation are treated as initial set-up and not counted.`,
  ];
  if (unreadable.status) caveats.push(`${unreadable.status} status-change events had no readable new status and are counted as "unknown".`);
  if (noTimeline) caveats.push(`${noTimeline} actions have no timeline items in the cache; their time is all attributed to "to_do" (or the period up to completion).`);
  if (wanted && actions.length < wanted.size) caveats.push(`${wanted.size - actions.length} requested action IDs are not in the cache.`);

  const top = by_status[0];
  const result = buildResult({
    version: "action-stalls/1",
    period: args.period,
    filters: { action_ids: args.action_ids, site_ids: args.site_ids, priority: args.priority },
    cache,
    feeds: ["actions", "action_timeline_items"],
    metrics: {
      actions: rows.length,
      open: rows.filter((r) => r.open).length,
      median_longest_gap_days: rows.length ? round(median(rows.map((r) => r.longest_gap_days)), 1) : null,
      with_due_date_changes: rows.filter((r) => r.due_date_changes > 0).length,
      with_reassignments: rows.filter((r) => r.reassignments > 0).length,
      stalls_most_in: top?.status ?? null,
    },
    table: rows.slice(0, args.limit),
    method:
      "Per action, the timeline is replayed from created_at: time accrues to the current status until each status change, ending at completion (or now when open); time after completion is not counted. " +
      "Longest gap = the longest stretch between consecutive timeline events (including creation and the end point). Aggregate shares are of all open-status time across the selected actions.",
    caveats,
    now,
  });
  return {
    result: { ...result, by_status },
    summary:
      `${rows.length} actions analysed` +
      (top ? `; most open time is spent in "${top.status}" (${top.share_of_open_time_pct}% of ${round(totalDays, 0)} action-days)` : "") +
      `; ${rows.filter((r) => r.due_date_changes > 0).length} had due-date changes and ${rows.filter((r) => r.reassignments > 0).length} were reassigned.`,
  };
}
