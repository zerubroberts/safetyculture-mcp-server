import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { ids, P } from "../core/params.js";
import { defineTool } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";

/**
 * Inspection schedules (current Schedules API + legacy schedule items) and
 * schedule occurrences from the `/scheduling/v1/feed/*` Data Feeds.
 *
 * Contract notes (verified with `node scripts/api-ref.mjs` 2026-10-08):
 * - There is no "list schedules" REST endpoint; listing uses the
 *   `GET /scheduling/v1/feed/schedules` feed plus the legacy
 *   `GET /schedules/v1/schedule_items` endpoint.
 * - The current-API feed rows carry no next-due timestamp and no assignee
 *   names (assignee IDs only); legacy items carry `next_occurrence`.
 * - The occurrences feed documents its fields but not the exact
 *   `occurrence_status` enum values, so status filtering is a documented
 *   heuristic (explicit status text first, due/miss timestamps second).
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

type ScheduleStatus = "active" | "paused" | "ended";
const scheduleStatus = z.enum(["active", "paused", "ended"]);

/** ACTIVE / PAUSED / FINISHED / ENDED / STATUS_* -> active / paused / ended. Unknown values pass through lowercased. */
export function normaliseScheduleStatus(raw: string | undefined): string {
  const s = (raw ?? "").toUpperCase();
  if (!s || s === "STATUS_UNSPECIFIED" || s === "UNKNOWN") return "unknown";
  if (s.includes("PAUS")) return "paused";
  if (s.includes("END") || s.includes("FINISH") || s.includes("DELET")) return "ended";
  if (s.includes("ACTIV")) return "active";
  return raw!.toLowerCase();
}

const WEEKDAYS: Record<string, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

/**
 * Turns an RFC 5545 recurrence (a bare RRULE or a combined DTSTART+RRULE
 * string) into plain English, e.g. "Weekly on Monday, Wednesday" or
 * "Every 3 days until 2026-12-31". Returns undefined when no FREQ is found.
 */
export function summariseRecurrence(rrule: string | undefined): string | undefined {
  if (!rrule) return undefined;
  const rrulePart = rrule.split("RRULE:").pop() ?? rrule;
  const props = new Map<string, string>();
  for (const chunk of rrulePart.split(";")) {
    const i = chunk.indexOf("=");
    if (i > 0) props.set(chunk.slice(0, i).trim().toUpperCase(), chunk.slice(i + 1).trim());
  }
  const freq = props.get("FREQ");
  if (!freq) return undefined;
  const interval = Number(props.get("INTERVAL") ?? "1") || 1;
  const unit =
    freq === "DAILY" ? "day" : freq === "WEEKLY" ? "week" : freq === "MONTHLY" ? "month" : freq === "YEARLY" ? "year" : undefined;
  if (!unit) return undefined;
  let out = interval === 1 ? `Every ${unit}`.replace("Every day", "Daily").replace("Every week", "Weekly").replace("Every month", "Monthly").replace("Every year", "Yearly") : `Every ${interval} ${unit}s`;
  if (freq === "WEEKLY") {
    const days = (props.get("BYDAY") ?? "")
      .split(",")
      .map((d) => WEEKDAYS[d.trim().toUpperCase()])
      .filter((d): d is string => Boolean(d));
    if (days.length) out += ` on ${days.join(", ")}`;
  }
  const count = props.get("COUNT");
  const until = props.get("UNTIL");
  if (count) out += `, ${count} times`;
  else if (until) out += ` until ${until.slice(0, 10)}`;
  return out;
}

interface FeedSchedule {
  id: string;
  title?: string;
  recurrence?: string;
  status?: string;
  template_id?: string;
  assignees?: string[];
  site_ids?: string[];
  asset_ids?: string[];
  timezone?: string;
}

interface LegacyScheduleItem {
  id: string;
  description?: string;
  recurrence?: string;
  status?: string;
  document?: { id?: string; name?: string };
  assignees?: Array<{ id?: string; type?: string; name?: string }>;
  location_id?: string;
  asset_id?: string;
  next_occurrence?: { start?: string; due?: string };
}

interface FeedOccurrence {
  id?: string;
  schedule_id?: string;
  occurrence_id?: string;
  template_id?: string;
  start_time?: string;
  due_time?: string;
  miss_time?: string;
  occurrence_status?: string;
  audit_id?: string;
  completed_at?: string;
  assignee_id?: string;
}

export type OccurrenceStatus = "missed" | "late" | "completed" | "upcoming" | "open";

/**
 * Classifies an occurrence. Prefers the API's own status text; falls back to
 * timestamps (done late -> late, overdue and not done -> missed, due in
 * future and not done -> upcoming). "open" means neither text nor timestamps
 * were conclusive.
 */
export function classifyOccurrence(o: FeedOccurrence, now = new Date()): OccurrenceStatus {
  const raw = (o.occurrence_status ?? "").toLowerCase();
  const done = Boolean(o.completed_at ?? o.audit_id) || raw.includes("complet");
  if (raw.includes("late")) return "late";
  if (raw.includes("miss")) return done ? "late" : "missed";
  if (done) {
    if (o.completed_at && o.due_time) {
      const c = Date.parse(o.completed_at);
      const d = Date.parse(o.due_time);
      if (Number.isFinite(c) && Number.isFinite(d) && c > d) return "late";
    }
    return "completed";
  }
  if (raw.includes("upcoming") || raw.includes("schedul") || raw.includes("pending") || raw.includes("open")) return "upcoming";
  const due = Date.parse(o.due_time ?? o.miss_time ?? "");
  if (!Number.isFinite(due)) return "open";
  return due < now.getTime() ? "missed" : "upcoming";
}

function projectFeedSchedule(s: FeedSchedule) {
  return {
    source: "schedules" as const,
    id: s.id,
    title: s.title,
    template: s.template_id,
    recurrence: summariseRecurrence(s.recurrence),
    recurrence_raw: s.recurrence,
    assignees: s.assignees,
    sites: s.site_ids,
    assets: s.asset_ids,
    status: normaliseScheduleStatus(s.status),
    timezone: s.timezone,
  };
}

function projectLegacyItem(item: LegacyScheduleItem) {
  return {
    source: "legacy" as const,
    id: item.id,
    title: item.description,
    template: item.document?.id ? { id: item.document.id, name: item.document.name } : undefined,
    recurrence: summariseRecurrence(item.recurrence),
    recurrence_raw: item.recurrence,
    assignees: item.assignees?.map((a) => ({ id: a.id, type: a.type?.toLowerCase(), name: a.name })),
    site: item.location_id,
    asset: item.asset_id,
    status: normaliseScheduleStatus(item.status),
    next_due: item.next_occurrence?.due,
    next_start: item.next_occurrence?.start,
  };
}

function projectOccurrence(o: FeedOccurrence, now: Date) {
  return {
    schedule: o.schedule_id,
    occurrence: o.occurrence_id ?? o.id,
    template: o.template_id,
    due_window: { start: o.start_time, due: o.due_time, miss_at: o.miss_time },
    status: classifyOccurrence(o, now),
    status_raw: o.occurrence_status,
    completed_inspection_id: o.audit_id || undefined,
    completed_at: o.completed_at || undefined,
    assignee: o.assignee_id || undefined,
  };
}

const scheduleId = z.string().describe("Schedule ID (from sc_list_schedules).");

export const schedulesTools = [
  defineTool({
    name: "sc_list_schedules",
    title: "List schedules",
    toolset: "schedules",
    access: "read",
    core: true,
    description:
      "Lists inspection schedules from the current Schedules API and, when present, legacy schedule items. Each row is labelled with its source. Rows carry title, template, recurrence in plain English when derivable, assignees, site, status (active/paused/ended) and next due date where the API provides one (legacy items only).",
    input: {
      status: z.array(scheduleStatus).optional().describe("Filter by status. Default: all statuses."),
      template_ids: P.templateIds,
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const limit = a.limit ?? 50;
      const wanted = new Set(a.status ?? []);
      const feedQuery: Record<string, string | number | boolean | string[] | undefined> = {
        limit,
        show_active: !wanted.size || wanted.has("active"),
        show_finished: !wanted.size || wanted.has("ended"),
        show_paused: !wanted.size || wanted.has("paused"),
        template: a.template_ids,
        next_page_token: a.page_token,
      };
      const legacyStatuses = [...wanted].map((s) => (s === "active" ? "ACTIVE" : s === "paused" ? "PAUSED" : "FINISHED"));
      const [feed, legacy] = await Promise.all([
        ctx.client.get<{ data?: FeedSchedule[]; metadata?: { next_page_token?: string } }>("/scheduling/v1/feed/schedules", feedQuery),
        ctx.client
          .get<{ items?: LegacyScheduleItem[]; next_page_token?: string; total?: number }>("/schedules/v1/schedule_items", {
            page_size: Math.min(100, limit),
            page_token: a.page_token,
            statuses: legacyStatuses.length ? legacyStatuses : undefined,
          })
          .catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
      ]);
      const current = (feed.data ?? []).map(projectFeedSchedule);
      const old = "items" in legacy ? ((legacy.items ?? []).map(projectLegacyItem)) : [];
      const legacyNote = "error" in legacy ? ` Legacy items unavailable: ${legacy.error}` : "";
      const rows = [...current, ...old];
      return {
        summary: `${current.length} current schedules and ${old.length} legacy schedule items.${legacyNote}${feed.metadata?.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: {
          total_current: current.length,
          total_legacy: old.length,
          schedules: rows,
          next_page_token: feed.metadata?.next_page_token || undefined,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_schedule",
    title: "Get schedule",
    toolset: "schedules",
    access: "read",
    description:
      "Gets one schedule in full: title, status, template, recurrence (raw and in plain English), assigned users and groups, target sites/assets summary and creator.",
    input: { schedule_id: scheduleId },
    run: async ({ schedule_id }, ctx) => {
      const s = await ctx.client.get<{
        id?: string;
        title?: string;
        status?: string;
        work_type?: { inspection?: { template_id?: string; template_name?: string } };
        recurrence?: { dtstart_rrule?: string; duration?: string; use_site_timezone?: boolean };
        completion_rule?: string;
        assignment?: {
          users?: { users?: Array<{ id?: string; name?: string }> };
          groups?: { groups?: Array<{ id?: string; name?: string }> };
        };
        target_summary?: { target_type?: string; total_count?: number };
        creator?: { id?: string; name?: string };
      }>(`/scheduling/v1/schedules/${encodeURIComponent(ids.uuid(schedule_id))}`);
      if (!s.id) throw new ToolError(`Schedule ${schedule_id} was not found.`);
      return {
        summary: `Schedule "${s.title}" is ${normaliseScheduleStatus(s.status)}.`,
        data: {
          id: s.id,
          title: s.title,
          status: normaliseScheduleStatus(s.status),
          status_raw: s.status,
          template: s.work_type?.inspection
            ? { id: s.work_type.inspection.template_id, name: s.work_type.inspection.template_name }
            : undefined,
          recurrence: summariseRecurrence(s.recurrence?.dtstart_rrule),
          recurrence_raw: s.recurrence?.dtstart_rrule,
          duration: s.recurrence?.duration,
          completion_rule: s.completion_rule?.replace("COMPLETION_RULE_", "").toLowerCase(),
          assignees: {
            users: s.assignment?.users?.users,
            groups: s.assignment?.groups?.groups,
          },
          targets: s.target_summary,
          creator: s.creator,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_schedule_occurrences",
    title: "List schedule occurrences",
    toolset: "schedules",
    access: "read",
    description:
      "Lists scheduled inspection occurrences due in a period (default last 30 days), with missed / late / completed / upcoming filters. Rows carry the schedule, due window, status, completed inspection ID and assignee. Occurrence status is derived from the API status text and due timestamps (see tool notes).",
    input: {
      period: P.period("last 30 days"),
      status: z.array(z.enum(["missed", "late", "completed", "upcoming"])).optional().describe("Only occurrences with these statuses. Default: all."),
      template_ids: P.templateIds,
      limit: P.limit(50, 500),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const p = parsePeriod(a.period, ctx.now());
      const res = await ctx.client.get<{ data?: FeedOccurrence[]; metadata?: { next_page_token?: string } }>(
        "/scheduling/v1/feed/schedule_occurrences",
        {
          limit: Math.min(1000, a.limit ?? 50),
          template: a.template_ids,
          start_date: p.from.toISOString(),
          end_date: p.to.toISOString(),
          next_page_token: a.page_token,
        },
      );
      const now = ctx.now();
      const wanted = new Set(a.status ?? []);
      const rows = (res.data ?? [])
        .map((o) => projectOccurrence(o, now))
        .filter((r) => !wanted.size || wanted.has(r.status as "missed" | "late" | "completed" | "upcoming"));
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return {
        summary: `${rows.length} occurrences due ${p.label}.${res.metadata?.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { period: p.label, by_status: counts, occurrences: rows, next_page_token: res.metadata?.next_page_token || undefined },
      };
    },
  }),

  defineTool({
    name: "sc_pause_schedule",
    title: "Pause schedule",
    toolset: "schedules",
    access: "write",
    idempotent: true,
    description:
      "Pauses an active schedule so it stops generating new occurrences. Existing occurrences are not affected. Pauses the whole schedule unless site_ids or asset_ids narrow it to sub-schedules (one of the two, matching the schedule's target type).",
    input: {
      schedule_id: scheduleId,
      site_ids: z.array(z.string()).max(10_000).optional().describe("Pause only these sites' sub-schedules."),
      asset_ids: z.array(z.string()).max(10_000).optional().describe("Pause only these assets' sub-schedules."),
      reason,
    },
    run: async (a, ctx) => {
      if (a.site_ids?.length && a.asset_ids?.length) throw new ToolError("Pass either site_ids or asset_ids, not both.");
      await ctx.client.patch(`/scheduling/v1/schedules/${encodeURIComponent(ids.uuid(a.schedule_id))}/pause`, {
        ...(a.site_ids?.length ? { sites: { site_ids: a.site_ids } } : {}),
        ...(a.asset_ids?.length ? { assets: { asset_ids: a.asset_ids } } : {}),
      });
      const scope = a.site_ids?.length ? `${a.site_ids.length} site(s)` : a.asset_ids?.length ? `${a.asset_ids.length} asset(s)` : "the whole schedule";
      return { summary: `Paused ${scope} of schedule ${a.schedule_id}.`, data: { id: a.schedule_id, paused: scope } };
    },
  }),

  defineTool({
    name: "sc_resume_schedule",
    title: "Resume schedule",
    toolset: "schedules",
    access: "write",
    idempotent: true,
    description:
      "Resumes a paused schedule so it starts generating new occurrences again. Resumes the whole schedule unless site_ids or asset_ids narrow it to sub-schedules (one of the two, matching the schedule's target type). Ended schedules cannot be resumed.",
    input: {
      schedule_id: scheduleId,
      site_ids: z.array(z.string()).max(10_000).optional().describe("Resume only these sites' sub-schedules."),
      asset_ids: z.array(z.string()).max(10_000).optional().describe("Resume only these assets' sub-schedules."),
      reason,
    },
    run: async (a, ctx) => {
      if (a.site_ids?.length && a.asset_ids?.length) throw new ToolError("Pass either site_ids or asset_ids, not both.");
      await ctx.client.patch(`/scheduling/v1/schedules/${encodeURIComponent(ids.uuid(a.schedule_id))}/resume`, {
        ...(a.site_ids?.length ? { sites: { site_ids: a.site_ids } } : {}),
        ...(a.asset_ids?.length ? { assets: { asset_ids: a.asset_ids } } : {}),
      });
      const scope = a.site_ids?.length ? `${a.site_ids.length} site(s)` : a.asset_ids?.length ? `${a.asset_ids.length} asset(s)` : "the whole schedule";
      return { summary: `Resumed ${scope} of schedule ${a.schedule_id}.`, data: { id: a.schedule_id, resumed: scope } };
    },
  }),

  defineTool({
    name: "sc_end_schedule",
    title: "End schedule",
    toolset: "schedules",
    access: "destructive",
    description:
      "Ends an active or paused schedule so it stops generating new occurrences. Existing occurrences are not affected. This cannot be undone: ended schedules cannot be reactivated. Pause instead for a temporary stop.",
    input: { schedule_id: scheduleId, reason },
    plan: async ({ schedule_id }, ctx) => {
      const s = await ctx.client.get<{
        id?: string;
        title?: string;
        status?: string;
        target_summary?: { target_type?: string; total_count?: number };
      }>(`/scheduling/v1/schedules/${encodeURIComponent(ids.uuid(schedule_id))}`);
      if (!s.id) throw new ToolError(`Schedule ${schedule_id} was not found.`);
      return {
        summary: `Schedule "${s.title}" (${normaliseScheduleStatus(s.status)}) would end and stop generating occurrences.`,
        data: { id: s.id, title: s.title, status: normaliseScheduleStatus(s.status), targets: s.target_summary },
        untrusted: true,
      };
    },
    run: async ({ schedule_id }, ctx) => {
      await ctx.client.patch(`/scheduling/v1/schedules/${encodeURIComponent(ids.uuid(schedule_id))}/end`, {});
      return { summary: `Ended schedule ${schedule_id}. It will no longer generate occurrences.`, data: { id: schedule_id, ended: true } };
    },
  }),
];
