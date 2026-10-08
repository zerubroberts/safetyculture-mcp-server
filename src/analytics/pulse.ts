import type { AnalyticResult, CacheReader, FeedName } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, previousPeriod, type Period } from "../core/time.js";
import { buildResult, nameMaps, str } from "./common.js";
import { isOverdue, isResolved, loadActions, normPriority, wholeDays } from "./backlog.js";
import { answeredItems, completedInspections, idIn, type Inspection } from "./failed-items.js";
import { loadOccurrences } from "./schedule-compliance.js";
import { mean, pct, round } from "./stats.js";

/**
 * Weekly safety pulse: this period vs the previous equal-length period.
 *
 * Feed fields relied on: see failed-items.ts (inspections, inspection_items), backlog.ts (actions),
 * schedule-compliance.ts (schedule_occurrences); issues: id, title, created_at, priority, site_id.
 */

export const PULSE_VERSION = "safety-pulse/1";
/** Both periods need at least this many observations before a direction is stated. */
export const MIN_OBS = 20;
/** Failed-rate rise (percentage points) on a template that earns an attention item. */
export const JUMP_PP = 10;

export interface PulseArgs {
  period?: string;
  site_ids?: string[];
}

export interface PulseRow {
  metric: string;
  unit: string;
  current: number | null;
  previous: number | null;
  delta: number | null;
  direction: "up" | "down" | "no change" | "too few to compare" | "snapshot";
  n_current: number;
  n_previous: number;
}

export interface AttentionItem {
  severity: 1 | 2 | 3 | 4;
  kind: "overdue_high_priority_action" | "missed_scheduled_inspections" | "failed_rate_jump" | "new_high_priority_issue";
  record_id: string;
  link?: string;
  detail: string;
}

export function direction(cur: number | null, prev: number | null, nCur: number, nPrev: number): PulseRow["direction"] {
  if (cur === null || prev === null || nCur < MIN_OBS || nPrev < MIN_OBS) return "too few to compare";
  return cur > prev ? "up" : cur < prev ? "down" : "no change";
}

const delta = (a: number | null, b: number | null, dp = 1) => (a === null || b === null ? null : round(a - b, dp));

interface PeriodStats {
  insp: Map<string, Inspection>;
  scores: number[];
  failed: number;
  answered: number;
  byTemplate: Map<string, { failed: number; answered: number; lastFailed?: Inspection }>;
  issues: Record<string, unknown>[];
  actionsCreated: number;
  actionsCompleted: number;
  missed: number;
  dueOccurrences: number;
  missedByTemplate: Map<string, number>;
}

function periodStats(cache: CacheReader, p: Period, siteIds: string[] | undefined, hasSchedules: boolean): PeriodStats {
  const insp = completedInspections(cache, p, { site_ids: siteIds });
  const scores = [...insp.values()].map((i) => i.score_pct).filter((s): s is number => s !== undefined);
  const { items, failed, answered } = answeredItems(cache, insp);
  const byTemplate = new Map<string, { failed: number; answered: number; lastFailed?: Inspection }>();
  for (const j of items) {
    const k = String(j.item.template_id ?? j.insp.template_id ?? "");
    if (!k) continue;
    const t = byTemplate.get(k) ?? { failed: 0, answered: 0 };
    t.answered++;
    if (j.failed) {
      t.failed++;
      if (!t.lastFailed || j.insp.completed_ms > t.lastFailed.completed_ms) t.lastFailed = j.insp;
    }
    byTemplate.set(k, t);
  }
  const inP = (v: unknown) => {
    const t = Date.parse(String(v ?? ""));
    return Number.isFinite(t) && t >= p.from.getTime() && t < p.to.getTime();
  };
  const issues = cache.rows("issues").filter((r) => inP(r.created_at) && idIn(r.site_id, siteIds));
  const actions = loadActions(cache, { site_ids: siteIds });
  const actionsCreated = actions.filter((a) => a.created_ms !== undefined && a.created_ms >= p.from.getTime() && a.created_ms < p.to.getTime()).length;
  const actionsCompleted = actions.filter((a) => isResolved(a) && a.completed_ms! >= p.from.getTime() && a.completed_ms! < p.to.getTime()).length;
  let missed = 0;
  let dueOccurrences = 0;
  const missedByTemplate = new Map<string, number>();
  if (hasSchedules) {
    for (const o of loadOccurrences(cache, p).occurrences) {
      if (siteIds?.length && !idIn(o.site_id, siteIds)) continue;
      dueOccurrences++;
      if (o.outcome === "missed") {
        missed++;
        const k = o.template_id ?? "(no template)";
        missedByTemplate.set(k, (missedByTemplate.get(k) ?? 0) + 1);
      }
    }
  }
  return { insp, scores, failed, answered, byTemplate, issues, actionsCreated, actionsCompleted, missed, dueOccurrences, missedByTemplate };
}

export function safetyPulse(
  cache: CacheReader,
  args: PulseArgs,
  now: Date,
): { summary: string; result: AnalyticResult<PulseRow> & { attention: AttentionItem[]; previous_period: { from: string; to: string; label: string } } } {
  const cur = parsePeriod(args.period, now, "last 7 days");
  const prev = previousPeriod(cur);
  const hasSchedules = cache.rows("schedule_occurrences").length > 0;
  const a = periodStats(cache, cur, args.site_ids, hasSchedules);
  const b = periodStats(cache, prev, args.site_ids, hasSchedules);
  const names = nameMaps(cache);
  const t = now.getTime();

  const row = (metric: string, unit: string, c: number | null, pv: number | null, nC: number, nP: number, dp = 1): PulseRow => ({
    metric,
    unit,
    current: c,
    previous: pv,
    delta: delta(c, pv, dp),
    direction: direction(c, pv, nC, nP),
    n_current: nC,
    n_previous: nP,
  });
  const avgA = round(mean(a.scores), 1);
  const avgB = round(mean(b.scores), 1);
  const frA = pct(a.failed, a.answered, 2);
  const frB = pct(b.failed, b.answered, 2);
  const table: PulseRow[] = [
    row("inspections_completed", "count", a.insp.size, b.insp.size, a.insp.size, b.insp.size, 0),
    row("average_score", "%", avgA, avgB, a.scores.length, b.scores.length),
    row("failed_item_rate", "% of answered items", frA, frB, a.answered, b.answered, 2),
    row("new_issues", "count", a.issues.length, b.issues.length, a.issues.length, b.issues.length, 0),
    row("actions_created", "count", a.actionsCreated, b.actionsCreated, a.actionsCreated, b.actionsCreated, 0),
    row("actions_completed", "count", a.actionsCompleted, b.actionsCompleted, a.actionsCompleted, b.actionsCompleted, 0),
  ];
  if (hasSchedules) table.push(row("missed_scheduled_inspections", "count", a.missed, b.missed, a.dueOccurrences, b.dueOccurrences, 0));

  const actions = loadActions(cache, { site_ids: args.site_ids });
  const overdue = actions.filter((x) => isOverdue(x, t));
  const oldestCreated = overdue.filter((x) => x.created_ms !== undefined).reduce<number | undefined>((m, x) => (m === undefined || x.created_ms! < m ? x.created_ms : m), undefined);
  const maxOverdue = overdue.reduce<number | undefined>((m, x) => (m === undefined || x.due_ms! < m ? x.due_ms : m), undefined);
  table.push({
    metric: "open_overdue_actions",
    unit: "count (now)",
    current: overdue.length,
    previous: null,
    delta: null,
    direction: "snapshot",
    n_current: overdue.length,
    n_previous: 0,
  });

  // Attention list, by severity: overdue high-priority action > missed occurrences on a template >
  // failed-rate jump of >= 10 points on a template > new high-priority issue. Within a tier: most severe first.
  const attention: AttentionItem[] = [];
  const tier1 = overdue
    .filter((x) => x.priority === "high")
    .sort((x, y) => x.due_ms! - y.due_ms! || x.id.localeCompare(y.id))
    .map<AttentionItem>((x) => ({
      severity: 1,
      kind: "overdue_high_priority_action",
      record_id: x.id,
      link: links.action(x.id),
      detail: `High-priority action "${x.title ?? x.id}" is ${wholeDays(x.due_ms!, t)} days overdue.`,
    }));
  const tier2 = [...a.missedByTemplate.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map<AttentionItem>(([tpl, n]) => ({
      severity: 2,
      kind: "missed_scheduled_inspections",
      record_id: tpl,
      detail: `${n} scheduled inspection${n === 1 ? "" : "s"} missed on template "${names.templates.get(tpl) ?? tpl}".`,
    }));
  const tier3: Array<AttentionItem & { jump: number }> = [];
  for (const [tpl, s] of a.byTemplate) {
    const p = b.byTemplate.get(tpl);
    if (!p || s.answered < MIN_OBS || p.answered < MIN_OBS) continue;
    const jump = (100 * s.failed) / s.answered - (100 * p.failed) / p.answered;
    if (jump < JUMP_PP) continue;
    tier3.push({
      severity: 3,
      kind: "failed_rate_jump",
      record_id: tpl,
      link: s.lastFailed ? links.inspection(s.lastFailed.id) : undefined,
      detail: `Failed-item rate on "${names.templates.get(tpl) ?? s.lastFailed?.template_name ?? tpl}" rose ${round(jump, 1)} points (${pct(p.failed, p.answered)}% of ${p.answered} to ${pct(s.failed, s.answered)}% of ${s.answered}).`,
      jump,
    });
  }
  tier3.sort((x, y) => y.jump - x.jump || x.record_id.localeCompare(y.record_id));
  const tier4 = a.issues
    .filter((r) => normPriority(r.priority) === "high")
    .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)) || String(x.id).localeCompare(String(y.id)))
    .map<AttentionItem>((r) => ({
      severity: 4,
      kind: "new_high_priority_issue",
      record_id: String(r.id),
      link: links.issue(String(r.id)),
      detail: `New high-priority issue "${str(r.title) ?? r.id}" raised ${String(r.created_at).slice(0, 10)}.`,
    }));
  for (const it of [...tier1, ...tier2, ...tier3.map(({ jump: _j, ...rest }) => rest), ...tier4]) {
    if (attention.length >= 3) break;
    attention.push(it);
  }

  const metrics: AnalyticResult["metrics"] = {};
  for (const r of table) {
    metrics[r.metric] = r.current;
    if (r.direction !== "snapshot") {
      metrics[`${r.metric}_previous`] = r.previous;
      metrics[`${r.metric}_delta`] = r.delta;
    }
  }
  metrics.oldest_overdue_action_age_days = oldestCreated !== undefined ? wholeDays(oldestCreated, t) : null;
  metrics.max_days_overdue = maxOverdue !== undefined ? wholeDays(maxOverdue, t) : null;
  metrics.scored_inspections = a.scores.length;
  metrics.answered_items = a.answered;
  metrics.failed_items = a.failed;

  const feeds: FeedName[] = ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences"];
  const caveats: string[] = [
    `Directions are stated only when both periods have at least ${MIN_OBS} observations; otherwise "too few to compare".`,
    "Lower issue counts can mean less reporting, not fewer hazards.",
    "Open overdue actions are a snapshot as of now, not a period figure.",
  ];
  if (!hasSchedules) caveats.push("No schedule occurrences are cached, so missed scheduled inspections are not reported.");
  if (args.site_ids?.length && cache.rows("issues").some((r) => !r.site_id)) caveats.push("Issues without a site are excluded when filtering by site.");

  const result = buildResult({
    version: PULSE_VERSION,
    period: cur,
    filters: { site_ids: args.site_ids },
    cache,
    feeds,
    metrics,
    table,
    method:
      "Each metric is computed for the period and the equal-length period before it. Failed-item rate = failed answered items / answered items in completed inspections; average score = mean score % of scored inspections; open overdue actions = open actions due before now.",
    caveats,
    now,
  });
  const dir = (r: PulseRow) => r.direction;
  const [ins, avg, fr] = table;
  const summary =
    `${cur.label}: ${ins!.current} inspections completed (previous ${ins!.previous}, ${dir(ins!)}), average score ${avg!.current ?? "n/a"}% (${dir(avg!)}), ` +
    `failed-item rate ${fr!.current ?? "n/a"}% of ${a.answered} answered items (${dir(fr!)}), ${a.issues.length} new issues, ${a.actionsCreated} actions created vs ${a.actionsCompleted} completed, ` +
    `${overdue.length} open overdue actions${hasSchedules ? `, ${a.missed} missed scheduled inspections` : ""}. ${attention.length} attention item${attention.length === 1 ? "" : "s"}.`;
  return {
    summary,
    result: { ...result, attention, previous_period: { from: prev.from.toISOString(), to: prev.to.toISOString(), label: prev.label } },
  };
}
