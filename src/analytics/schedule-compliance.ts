import type { AnalyticResult, CacheReader } from "../cache/contract.js";
import { parsePeriod, type Period } from "../core/time.js";
import { buildResult, feedProblem, field, nameMaps, str, unavailableSentence } from "./common.js";
import { canon, idIn } from "./failed-items.js";
import { pct } from "./stats.js";

/**
 * Scheduled-inspection compliance from the schedule occurrences feed.
 *
 * Feed fields relied on (api-ref schedulingfeedservice_feedscheduleoccurrences / _feedschedules / _feedscheduleassignees):
 *   schedule_occurrences: id, schedule_id, occurrence_id, template_id, due_time, occurrence_status, audit_id,
 *                         completion_rule, assignee_id (legacy feed: user_id), assignee_from ("location_<site id>" etc.)
 *   schedules: id, title (legacy: description), site_ids (array; legacy: site_id), template_id
 *   schedule_assignees: assignee_id, name
 *   inspections: id, site_id (site of the inspection created from an occurrence)
 * occurrence_status values (documented): TODO, IN_PROGRESS, COMPLETED (on time), LATE (finished after miss_time),
 * OVERDUE (past miss_time, not started), MISSED (past due_time, not completed), WONT_DO.
 */

export type Outcome = "on_time" | "late" | "missed" | "wont_do" | "pending" | "unknown";

export function outcomeOf(status: unknown): Outcome {
  const s = String(status ?? "").trim().toUpperCase();
  if (s === "COMPLETED") return "on_time";
  if (s === "LATE") return "late";
  if (s === "MISSED") return "missed";
  if (s === "WONT_DO") return "wont_do";
  if (s === "TODO" || s === "IN_PROGRESS" || s === "OVERDUE") return "pending";
  return "unknown";
}

// Combining assignee rows of one occurrence: "any" takes the best outcome, "all" the worst.
const RANK: Record<Outcome, number> = { on_time: 0, late: 1, pending: 2, wont_do: 3, missed: 4, unknown: 5 };

export interface Occurrence {
  key: string;
  schedule_id: string;
  template_id?: string;
  site_id?: string;
  /** Raw assignee IDs on this occurrence (one per feed row). */
  assignees: string[];
  outcome: Outcome;
  due_ms: number;
  audit_id?: string;
  multi_site: boolean;
}

const asList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  const s = str(v);
  if (!s || !s.trim()) return [];
  const t = s.trim();
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return t
    .split(/[|,]/)
    .map((x) => x.trim())
    .filter(Boolean);
};

/**
 * Occurrences whose due_time falls in the period (all if omitted), one per schedule + occurrence (+ site for
 * site-based assignment). Site = site of the linked inspection, else the location in assignee_from, else the
 * schedule's site when it has exactly one.
 */
export function loadOccurrences(cache: CacheReader, p?: Period): { occurrences: Occurrence[]; rowsPerOccurrence: Map<string, Array<{ assignee: string; outcome: Outcome }>> } {
  const schedules = new Map<string, string[]>();
  for (const s of cache.rows("schedules")) schedules.set(canon(s.id), asList(field(s, "site_ids", "site_id")));
  const inspSite = new Map<string, string>();
  for (const i of cache.rows("inspections")) if (str(i.site_id)) inspSite.set(canon(i.id), String(i.site_id));

  interface Acc { occ: Occurrence; outcomes: Outcome[]; rule: string }
  const accs = new Map<string, Acc>();
  const perRow = new Map<string, Array<{ assignee: string; outcome: Outcome }>>();
  for (const r of cache.rows("schedule_occurrences")) {
    const due = Date.parse(String(r.due_time ?? ""));
    if (!Number.isFinite(due)) continue;
    if (p && (due < p.from.getTime() || due >= p.to.getTime())) continue;
    const scheduleId = String(r.schedule_id ?? "");
    const from = String(r.assignee_from ?? "");
    const locSite = /^location_/i.test(from) ? from.replace(/^location_/i, "") : undefined;
    const key = `${canon(scheduleId)}|${String(r.occurrence_id ?? r.id)}|${locSite ? canon(locSite) : ""}`;
    const outcome = outcomeOf(r.occurrence_status);
    const auditId = str(r.audit_id) || undefined;
    const assignee = String(field(r, "assignee_id", "user_id") ?? "");
    let a = accs.get(key);
    if (!a) {
      const schedSites = schedules.get(canon(scheduleId)) ?? [];
      a = {
        occ: {
          key,
          schedule_id: scheduleId,
          template_id: str(r.template_id) || undefined,
          site_id: locSite ?? (schedSites.length === 1 ? schedSites[0] : undefined),
          assignees: [],
          outcome,
          due_ms: due,
          multi_site: !locSite && schedSites.length > 1,
          audit_id: auditId,
        },
        outcomes: [],
        rule: String(r.completion_rule ?? "any").toLowerCase(),
      };
      accs.set(key, a);
    }
    a.outcomes.push(outcome);
    if (assignee) a.occ.assignees.push(assignee);
    if (auditId) {
      a.occ.audit_id ??= auditId;
      const s = inspSite.get(canon(auditId));
      if (s) {
        a.occ.site_id = s;
        a.occ.multi_site = false;
      }
    }
    const list = perRow.get(key) ?? [];
    list.push({ assignee: assignee || "(unassigned)", outcome });
    perRow.set(key, list);
  }
  const occurrences = [...accs.values()].map(({ occ, outcomes, rule }) => {
    const ranks = outcomes.map((o) => RANK[o]);
    const r = rule === "all" ? Math.max(...ranks) : Math.min(...ranks);
    occ.outcome = (Object.keys(RANK) as Outcome[]).find((k) => RANK[k] === r)!;
    return occ;
  });
  return { occurrences, rowsPerOccurrence: perRow };
}

export interface ComplianceCounts {
  due: number;
  on_time: number;
  late: number;
  missed: number;
  wont_do: number;
  pending: number;
  unknown: number;
}
const zero = (): ComplianceCounts => ({ due: 0, on_time: 0, late: 0, missed: 0, wont_do: 0, pending: 0, unknown: 0 });
const add = (c: ComplianceCounts, o: Outcome) => {
  c.due++;
  c[o]++;
};
/** Resolved = on time + late + missed. Won't-do and still-open occurrences are outside the denominator. */
export const resolved = (c: ComplianceCounts) => c.on_time + c.late + c.missed;

export const SCHEDULE_VERSION = "schedule-compliance/1";

export interface ScheduleArgs {
  period?: string;
  site_ids?: string[];
  template_ids?: string[];
  group_by?: "schedule" | "site" | "assignee" | "template";
}

export interface ComplianceRow extends ComplianceCounts {
  group: string;
  /** "person" when grouped by assignee, so strict privacy pseudonymises the group name. */
  group_kind: string;
  key: string;
  resolved: number;
  compliance_pct: number | null;
  late_pct: number | null;
  missed_pct: number | null;
}

export function analyzeScheduleCompliance(
  cache: CacheReader,
  args: ScheduleArgs,
  now: Date,
): { summary: string; result: AnalyticResult<ComplianceRow> & { worst: ComplianceRow[] } } {
  const period = parsePeriod(args.period, now, "last 30 days");
  const groupBy = args.group_by ?? "schedule";
  const feeds = ["schedule_occurrences", "schedules", "schedule_assignees", "inspections"] as const;
  const filters = { site_ids: args.site_ids, template_ids: args.template_ids, group_by: groupBy };
  const totalRows = cache.rows("schedule_occurrences").length;
  const problem = feedProblem(cache, "schedule_occurrences");

  if (problem || totalRows === 0) {
    const result = buildResult<ComplianceRow>({
      version: SCHEDULE_VERSION,
      period,
      filters,
      cache,
      feeds: [...feeds],
      metrics: { due: null, on_time: null, late: null, missed: null, compliance_pct: null },
      table: [],
      method: problem ? "Compliance needs schedule occurrences; the feed could not be read." : "Compliance needs schedule occurrences; none are cached.",
      caveats: [
        problem
          ? `No scheduling data: ${problem}. This is not 0% or 100% compliance.`
          : "The schedule occurrences feed is synced and empty: nothing was scheduled, so there is no compliance rate to report.",
      ],
      now,
    });
    return {
      summary: problem
        ? unavailableSentence("Schedule compliance", problem)
        : "Nothing was scheduled (the schedule occurrences feed is synced and empty), so there is no compliance rate to report.",
      result: { ...result, worst: [] },
    };
  }

  const names = nameMaps(cache);
  const schedTitles = new Map<string, string>();
  for (const s of cache.rows("schedules")) schedTitles.set(canon(s.id), String(field(s, "title", "description") ?? s.id));
  const assigneeNames = new Map<string, string>();
  for (const a of cache.rows("schedule_assignees")) if (str(a.name)) assigneeNames.set(canon(a.assignee_id), String(a.name));
  for (const [id, n] of names.users) if (!assigneeNames.has(canon(id))) assigneeNames.set(canon(id), n);

  const { occurrences, rowsPerOccurrence } = loadOccurrences(cache, period);
  let unattributed = 0;
  const selected = occurrences.filter((o) => {
    if (!idIn(o.template_id, args.template_ids)) return false;
    if (args.site_ids?.length) {
      if (!o.site_id) {
        unattributed++;
        return false;
      }
      return idIn(o.site_id, args.site_ids);
    }
    return true;
  });

  const total = zero();
  for (const o of selected) add(total, o.outcome);

  const groups = new Map<string, { name: string; c: ComplianceCounts }>();
  const bump = (key: string, name: string, o: Outcome) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name, c: zero() }));
    add(g.c, o);
  };
  for (const o of selected) {
    if (groupBy === "assignee") {
      // Per assignee row, using that row's own status.
      for (const r of rowsPerOccurrence.get(o.key) ?? []) bump(canon(r.assignee) || r.assignee, assigneeNames.get(canon(r.assignee)) ?? r.assignee, r.outcome);
    } else if (groupBy === "site") {
      const k = o.site_id ? canon(o.site_id) : o.multi_site ? "(multiple sites)" : "(no site)";
      bump(k, o.site_id ? (names.sites.get(o.site_id) ?? o.site_id) : k, o.outcome);
    } else if (groupBy === "template") {
      const k = o.template_id ? canon(o.template_id) : "(no template)";
      bump(k, o.template_id ? (names.templates.get(o.template_id) ?? o.template_id) : k, o.outcome);
    } else {
      bump(canon(o.schedule_id), schedTitles.get(canon(o.schedule_id)) ?? o.schedule_id, o.outcome);
    }
  }
  const row = (key: string, name: string, c: ComplianceCounts): ComplianceRow => ({
    group: name,
    group_kind: groupBy === "assignee" ? "person" : groupBy,
    key,
    ...c,
    resolved: resolved(c),
    compliance_pct: pct(c.on_time, resolved(c)),
    late_pct: pct(c.late, resolved(c)),
    missed_pct: pct(c.missed, resolved(c)),
  });
  const table = [...groups.entries()]
    .map(([k, g]) => row(k, g.name, g.c))
    .sort(
      (x, y) =>
        (x.compliance_pct ?? 101) - (y.compliance_pct ?? 101) || y.missed - x.missed || y.resolved - x.resolved || x.group.localeCompare(y.group),
    );
  const worst = table.filter((r) => r.resolved > 0).slice(0, 10);

  const stale = selected.filter((o) => (o.outcome === "pending" || o.outcome === "unknown") && o.due_ms < now.getTime()).length;
  const caveats: string[] = [];
  if (stale) caveats.push(`${stale} occurrences are past their due time but still show an open status in the cache; re-sync before treating them as pending.`);
  if (total.unknown) caveats.push(`${total.unknown} occurrences have an unrecognised status and are excluded from compliance.`);
  if (unattributed) caveats.push(`${unattributed} occurrences could not be tied to a single site and were left out of the site filter.`);
  if (total.wont_do) caveats.push(`${total.wont_do} occurrences were marked "won't do" and are excluded from the compliance denominator.`);
  if (groupBy === "assignee") caveats.push("Assignee rows use each assignee's own status; an occurrence with several assignees counts once per assignee.");

  const res = resolved(total);
  const result = buildResult({
    version: SCHEDULE_VERSION,
    period,
    filters,
    cache,
    feeds: [...feeds],
    metrics: {
      due: total.due,
      on_time: total.on_time,
      late: total.late,
      missed: total.missed,
      wont_do: total.wont_do,
      pending: total.pending,
      resolved: res,
      compliance_pct: pct(total.on_time, res),
      late_pct: pct(total.late, res),
      missed_pct: pct(total.missed, res),
    },
    table,
    method:
      "Occurrences due in the period, one per schedule occurrence. Compliance = completed on time / (on time + late + missed); late and missed are shown separately; won't-do and not-yet-resolved occurrences are excluded from the denominator.",
    caveats,
    now,
  });
  const summary = res
    ? `${total.due} scheduled occurrences due ${period.label}: ${total.on_time} on time, ${total.late} late, ${total.missed} missed, ${total.pending} pending; compliance ${pct(total.on_time, res)}% of ${res} resolved.`
    : `${total.due} scheduled occurrences due ${period.label}, none resolved yet (${total.pending} pending), so compliance cannot be computed.`;
  return { summary, result: { ...result, worst } };
}
