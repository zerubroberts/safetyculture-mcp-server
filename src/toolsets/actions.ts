import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { countBy, ids, links, P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";

/**
 * Reference toolset: every other toolset follows this shape.
 * - compact row projections (never raw API payloads)
 * - one patch-style update tool instead of a tool per field
 * - bulk changes are destructive: dry-run plan first, then confirm_token
 */

// System status and priority IDs, identical across organisations (verified against the live API 2026-10-08).
export const ACTION_STATUS = {
  to_do: "17e793a1-26a3-4ecd-99ca-f38ecc6eaa2e",
  in_progress: "20ce0cb1-387a-47d4-8c34-bc6fd3be0e27",
  complete: "7223d809-553e-4714-a038-62dc98f3fbf3",
  cant_do: "06308884-41c2-4ee0-9da7-5676647d3d75",
} as const;
export const ACTION_PRIORITY = {
  low: "16ba4717-adc9-4d48-bf7c-044cfe0d2727",
  medium: "ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055",
  high: "02eb40c1-4f46-40c5-be16-d32941c96ec9",
} as const;
const STATUS_NAMES = Object.fromEntries(Object.entries(ACTION_STATUS).map(([k, v]) => [v, k]));
const PRIORITY_NAMES = Object.fromEntries(Object.entries(ACTION_PRIORITY).map(([k, v]) => [v, k]));
const OPEN_STATUSES = [ACTION_STATUS.to_do, ACTION_STATUS.in_progress];

const status = z.enum(["to_do", "in_progress", "complete", "cant_do"]);
const priority = z.enum(["low", "medium", "high"]);
const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log; for new actions it is appended to the description.");
const assignees = z
  .array(z.object({ id: z.string(), type: z.enum(["user", "group"]).default("user") }))
  .optional()
  .describe("Assignees: user IDs (user_...) or group IDs. Find them with sc_search_users / sc_list_groups.");

interface RawTask {
  task_id: string;
  unique_id?: string;
  title?: string;
  description?: string;
  created_at?: string;
  modified_at?: string;
  due_at?: string;
  completed_at?: string | null;
  priority_id?: string;
  status_id?: string;
  status?: { key?: string; label?: string };
  template_id?: string;
  template_name?: string;
  inspection?: { inspection_id?: string; inspection_name?: string };
  inspection_item?: { inspection_item_id?: string; inspection_item_name?: string };
  site?: { id?: string; name?: string };
  asset?: { id?: string; code?: string; name?: string };
  creator?: { user_id?: string; firstname?: string; lastname?: string };
  collaborators?: Array<{
    collaborator_id?: string;
    collaborator_type?: string;
    assigned_role?: string;
    user?: { user_id?: string; firstname?: string; lastname?: string };
    group?: { group_id?: string; name?: string };
  }>;
  action_label?: Array<{ label_id?: string; label_name?: string }>;
}

const fullName = (u?: { firstname?: string; lastname?: string }) => [u?.firstname, u?.lastname].filter(Boolean).join(" ") || undefined;

/** The compact shape every action tool returns. */
export function projectAction(t: RawTask, now = new Date()) {
  const open = !t.status_id || OPEN_STATUSES.includes(t.status_id as (typeof OPEN_STATUSES)[number]);
  const overdueDays = open && t.due_at ? Math.floor((now.getTime() - Date.parse(t.due_at)) / 86_400_000) : undefined;
  return {
    id: t.task_id,
    ref: t.unique_id,
    title: t.title,
    status: STATUS_NAMES[t.status_id ?? ""] ?? t.status?.key?.toLowerCase() ?? t.status_id,
    priority: PRIORITY_NAMES[t.priority_id ?? ""] ?? (t.priority_id ? "other" : "none"),
    due_at: t.due_at,
    overdue_days: overdueDays !== undefined && overdueDays > 0 ? overdueDays : undefined,
    created_at: t.created_at,
    completed_at: t.completed_at ?? undefined,
    site: t.site?.name ? { id: t.site.id, name: t.site.name } : undefined,
    assignees: (t.collaborators ?? [])
      .filter((c) => c.assigned_role === "ASSIGNEE")
      .map((c) => (c.group ? { group: c.group.name, id: c.group.group_id } : { user: fullName(c.user), id: c.user?.user_id ?? c.collaborator_id })),
    creator: fullName(t.creator),
    labels: t.action_label?.map((l) => l.label_name).filter(Boolean),
    inspection: t.inspection?.inspection_id
      ? { id: t.inspection.inspection_id, name: t.inspection.inspection_name, item: t.inspection_item?.inspection_item_name }
      : undefined,
    template: t.template_name,
    asset: t.asset?.id ? { id: t.asset.id, code: t.asset.code, name: t.asset.name } : undefined,
    link: links.action(t.task_id),
  };
}

type Filter = Record<string, unknown>;

interface ListFilters {
  status?: z.infer<typeof status>[];
  priority?: z.infer<typeof priority>[];
  site_ids?: string[];
  template_ids?: string[];
  inspection_id?: string;
  assignee_ids?: string[];
  label_ids?: string[];
  title_contains?: string;
  created?: string;
  due?: string;
  overdue_only?: boolean;
}

/** Translates friendly filters into the API's task_filters array (AND across objects, OR within). */
export function buildTaskFilters(f: ListFilters, now = new Date()): Filter[] {
  const out: Filter[] = [];
  const statuses = f.overdue_only ? (f.status?.length ? f.status : ["to_do", "in_progress"]) : f.status;
  if (statuses?.length) out.push({ status_id: { value: statuses.map((s) => ACTION_STATUS[s as keyof typeof ACTION_STATUS]) } });
  if (f.priority?.length) out.push({ priority_id: { value: f.priority.map((p) => ACTION_PRIORITY[p]) } });
  if (f.site_ids?.length) out.push({ site_id: { value: f.site_ids } });
  if (f.template_ids?.length) out.push({ template_id: { value: f.template_ids.map(ids.template) } });
  if (f.inspection_id) out.push({ inspection_id: { value: [ids.audit(f.inspection_id)] } });
  if (f.label_ids?.length) out.push({ label_id: { value: f.label_ids } });
  if (f.assignee_ids?.length)
    out.push({ collaborators: { value: f.assignee_ids.map((id) => ({ collaborator_id: id, assigned_role: "ASSIGNEE" })) } });
  if (f.title_contains) out.push({ title: { term: f.title_contains } });
  if (f.created) {
    const p = parsePeriod(f.created, now);
    out.push({ created_at: { from: { time: p.from.toISOString() }, to: { time: p.to.toISOString() } } });
  }
  if (f.overdue_only) out.push({ due_at: { to: { time: now.toISOString() } } });
  else if (f.due) {
    const p = parsePeriod(f.due, now);
    out.push({ due_at: { from: { time: p.from.toISOString() }, to: { time: p.to.toISOString() } } });
  }
  return out;
}

const listInput = {
  status: z.array(status).optional().describe("Filter by status. Default: all statuses."),
  priority: z.array(priority).optional(),
  site_ids: P.siteIds,
  template_ids: P.templateIds,
  inspection_id: z.string().optional().describe("Only actions raised from this inspection (audit_...)."),
  assignee_ids: z.array(z.string()).optional().describe("Only actions assigned to these user or group IDs."),
  label_ids: z.array(z.string()).optional(),
  title_contains: z.string().optional().describe("Text that must appear in the action title."),
  created: z.string().optional().describe('Created within this period, e.g. "last 30 days", "2026-Q3".'),
  due: z.string().optional().describe('Due within this period, e.g. "this month" or "2026-10-01..2026-10-31".'),
  overdue_only: z.boolean().optional().describe("Only open actions whose due date has passed."),
};

async function listActions(ctx: ToolContext, f: ListFilters, opts: { limit: number; sort?: string; direction?: string; pageToken?: string }) {
  const res = await ctx.client.post<{ actions?: Array<{ task: RawTask }>; next_page_token?: string; total?: number }>("/tasks/v1/actions/list", {
    page_size: Math.min(100, opts.limit),
    page_token: opts.pageToken,
    task_filters: buildTaskFilters(f, ctx.now()),
    sort_field: opts.sort,
    sort_direction: opts.direction,
  });
  return res;
}

async function collectActions(ctx: ToolContext, f: ListFilters, max: number) {
  return ctx.client.collectPages(
    async (token) => {
      const r = await listActions(ctx, f, { limit: 100, pageToken: token, sort: "DATE_DUE", direction: "ASC" });
      return { items: r.actions?.map((a) => a.task) ?? [], next: r.next_page_token };
    },
    { maxItems: max },
  );
}

export const actionTools = [
  defineTool({
    name: "sc_list_actions",
    title: "List actions",
    toolset: "actions",
    access: "read",
    core: true,
    description:
      "Lists corrective actions with filters (status, priority, site, template, inspection, assignee, label, title text, created/due period, overdue). Returns compact rows with assignees, due date, days overdue and a web link, plus counts by status and priority.",
    input: {
      ...listInput,
      sort: z.enum(["due", "created", "modified", "priority"]).optional().describe("Sort order. Default: newest first."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const sortField = { due: "DATE_DUE", created: "CREATED_AT", modified: "MODIFIED_AT", priority: "PRIORITY" }[a.sort ?? "created"];
      const res = await listActions(ctx, a, {
        limit: a.limit ?? 50,
        pageToken: a.page_token,
        sort: sortField,
        direction: a.sort === "due" ? "ASC" : "DESC",
      });
      const rows = (res.actions ?? []).map((x) => projectAction(x.task, ctx.now()));
      return {
        summary: `${res.total ?? rows.length} actions match; showing ${rows.length}.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: {
          total: res.total,
          by_status: countBy(rows, (r) => r.status),
          by_priority: countBy(rows, (r) => r.priority),
          actions: rows,
          next_page_token: res.next_page_token || undefined,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_action",
    title: "Get action",
    toolset: "actions",
    access: "read",
    core: true,
    description: "Gets one action in full: description, status, priority, assignees, labels, linked inspection and item, site, asset and custom fields.",
    input: { action_id: P.actionId },
    run: async ({ action_id }, ctx) => {
      const res = await ctx.client.get<{
        action?: { task: RawTask; custom_field_and_values?: unknown[]; type?: { name?: string } };
        read_only?: boolean;
      }>(`/tasks/v1/actions/${encodeURIComponent(action_id)}`);
      const task = res.action?.task;
      if (!task) throw new ToolError(`Action ${action_id} was not found.`);
      return {
        summary: `Action "${task.title}" is ${STATUS_NAMES[task.status_id ?? ""] ?? "in an unknown status"}.`,
        data: {
          ...projectAction(task, ctx.now()),
          description: task.description,
          type: res.action?.type?.name,
          custom_fields: res.action?.custom_field_and_values,
          read_only: res.read_only,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_action_options",
    title: "List action statuses, priorities, labels and types",
    toolset: "actions",
    access: "read",
    description: "Returns the valid action statuses and priorities, the organisation's action labels and its action types. Call before filtering by label or creating typed actions.",
    input: {},
    run: async (_a, ctx) => {
      const [labels, types] = await Promise.all([
        ctx.client.get<{ labels?: Array<{ label_id: string; label_name: string }> }>("/tasks/v1/customer_configuration/action_labels").catch(() => ({ labels: [] })),
        ctx.client.get<{ types?: unknown[] }>("/tasks/v1/customer_configuration/task_types").catch(() => ({ types: [] })),
      ]);
      return {
        summary: `${labels.labels?.length ?? 0} labels and ${types.types?.length ?? 0} action types.`,
        data: {
          statuses: Object.keys(ACTION_STATUS),
          priorities: Object.keys(ACTION_PRIORITY),
          labels: labels.labels?.map((l) => ({ id: l.label_id, name: l.label_name })),
          types: types.types,
        },
      };
    },
  }),

  defineTool({
    name: "sc_create_action",
    title: "Create action",
    toolset: "actions",
    access: "write",
    core: true,
    description:
      "Creates one corrective action, optionally linked to an inspection (and item), a site and an asset, with assignees, priority, due date and labels. Returns the new action's ID and link.",
    input: {
      title: z.string().min(1).max(500),
      description: z.string().max(25_000).optional(),
      priority: priority.optional(),
      due_at: z.string().datetime({ offset: true }).optional().describe("Due date-time, ISO 8601, e.g. 2026-10-31T17:00:00+11:00."),
      site_id: z.string().optional(),
      assignees,
      inspection_id: z.string().optional().describe("Link to this inspection (audit_...)."),
      inspection_item_id: z.string().optional().describe("Link to a specific question in that inspection."),
      asset_id: z.string().optional(),
      label_ids: z.array(z.string()).optional(),
      reason,
    },
    run: async (a, ctx) => {
      const description = [a.description, a.reason ? `\n\nRaised via safetyculture-mcp: ${a.reason}` : ""].join("").trim();
      const res = await ctx.client.post<{ action_id?: string }>("/tasks/v1/actions", {
        title: a.title,
        description: description || undefined,
        priority_id: a.priority ? ACTION_PRIORITY[a.priority] : undefined,
        status_id: ACTION_STATUS.to_do,
        due_at: a.due_at ? new Date(a.due_at).toISOString() : undefined,
        site_id: a.site_id,
        inspection_id: a.inspection_id ? ids.audit(a.inspection_id) : undefined,
        inspection_item_id: a.inspection_item_id,
        asset_id: a.asset_id,
        label_ids: a.label_ids,
        collaborators: a.assignees?.map((x) => ({
          collaborator_id: x.id,
          collaborator_type: x.type === "group" ? "GROUP" : "USER",
          assigned_role: "ASSIGNEE",
        })),
      });
      if (!res.action_id) throw new ToolError("The API accepted the request but returned no action ID. Check the Actions list before retrying, to avoid a duplicate.");
      return { summary: `Created action "${a.title}".`, data: { id: res.action_id, link: links.action(res.action_id) } };
    },
  }),

  defineTool({
    name: "sc_update_action",
    title: "Update action",
    toolset: "actions",
    access: "write",
    core: true,
    idempotent: true,
    description:
      "Updates one action. Pass only the fields to change: title, description, status, priority, due_at, site_id, assignees (replaces the list) or label_ids (replaces the list). Returns which fields changed.",
    input: {
      action_id: P.actionId,
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(25_000).optional(),
      status: status.optional(),
      priority: priority.optional(),
      due_at: z.string().datetime({ offset: true }).nullable().optional().describe("New due date-time (ISO 8601), or null to clear it."),
      site_id: z.string().optional(),
      assignees,
      label_ids: z.array(z.string()).optional(),
      reason,
    },
    run: async (a, ctx) => {
      const id = encodeURIComponent(a.action_id);
      const base = `/tasks/v1/actions/${id}`;
      const calls: Array<[string, () => Promise<unknown>]> = [];
      if (a.title !== undefined) calls.push(["title", () => ctx.client.put(`${base}/title`, { title: a.title })]);
      if (a.description !== undefined) calls.push(["description", () => ctx.client.put(`${base}/description`, { description: a.description })]);
      if (a.status) calls.push(["status", () => ctx.client.put(`${base}/status`, { status_id: ACTION_STATUS[a.status!] })]);
      if (a.priority) calls.push(["priority", () => ctx.client.put(`${base}/priority`, { priority_id: ACTION_PRIORITY[a.priority!] })]);
      if (a.due_at !== undefined)
        calls.push(["due_at", () => ctx.client.put(`${base}/due_at`, a.due_at ? { due_at: new Date(a.due_at).toISOString() } : {})]);
      if (a.site_id !== undefined) calls.push(["site", () => ctx.client.put(`${base}/site`, { site_id: { value: a.site_id } })]);
      if (a.label_ids) calls.push(["labels", () => ctx.client.put(`/tasks/v1/actions/${id}/label`, { label_ids: a.label_ids })]);
      if (a.assignees)
        calls.push([
          "assignees",
          () =>
            ctx.client.put(`${base}/assignees`, {
              assignees: a.assignees!.map((x) => ({
                collaborator_id: x.id,
                collaborator_type: x.type === "group" ? "GROUP" : "USER",
                assigned_role: "ASSIGNEE",
              })),
            }),
        ]);
      if (!calls.length) throw new ToolError("Nothing to update: pass at least one field to change.");

      const changed: string[] = [];
      const failed: Array<{ field: string; error: string }> = [];
      for (const [field, call] of calls) {
        try {
          await call();
          changed.push(field);
        } catch (e) {
          failed.push({ field, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return {
        summary: failed.length
          ? `Updated ${changed.length} of ${calls.length} fields; ${failed.length} failed (${failed.map((f) => f.field).join(", ")}).`
          : `Updated ${changed.join(", ")}.`,
        data: { id: a.action_id, changed, failed: failed.length ? failed : undefined, link: links.action(a.action_id) },
      };
    },
  }),

  defineTool({
    name: "sc_create_action_link",
    title: "Create shareable action link",
    toolset: "actions",
    access: "write",
    description: "Creates a link that lets someone without a Mitti login view and complete one action (for contractors). Anyone with the link can open it.",
    input: { action_id: P.actionId },
    run: async ({ action_id }, ctx) => {
      const res = await ctx.client.post<{ link?: { url?: string } }>(`/tasks/v1/actions/${encodeURIComponent(action_id)}/shared_link`, {});
      return { summary: "Created a shareable link. Treat it like a password: anyone holding it can open the action.", data: { url: res.link?.url } };
    },
  }),

  defineTool({
    name: "sc_bulk_update_actions",
    title: "Bulk update actions",
    toolset: "actions",
    access: "destructive",
    description:
      "Changes status, priority, due date and/or assignees on many actions at once, selected either by explicit action_ids or by the same filters as sc_list_actions. Maximum 200 actions per call.",
    input: {
      action_ids: z.array(z.string()).max(200).optional(),
      filters: z.object(listInput).partial().optional().describe("Select actions with sc_list_actions filters instead of IDs."),
      set: z
        .object({
          status: status.optional(),
          priority: priority.optional(),
          due_at: z.string().datetime({ offset: true }).optional(),
          assignees,
        })
        .describe("The changes to apply to every selected action."),
      reason,
    },
    plan: async (a, ctx) => {
      const targets = await resolveTargets(a, ctx);
      return {
        summary: `${targets.length} actions would change: ${describeSet(a.set)}.`,
        data: { count: targets.length, sample: targets.slice(0, 15), changes: a.set },
        untrusted: true,
      };
    },
    run: async (a, ctx) => {
      const targets = await resolveTargets(a, ctx);
      const results = { updated: 0, failed: [] as Array<{ id: string; error: string }> };
      for (const t of targets) {
        try {
          const base = `/tasks/v1/actions/${encodeURIComponent(t.id)}`;
          if (a.set.status) await ctx.client.put(`${base}/status`, { status_id: ACTION_STATUS[a.set.status] });
          if (a.set.priority) await ctx.client.put(`${base}/priority`, { priority_id: ACTION_PRIORITY[a.set.priority] });
          if (a.set.due_at) await ctx.client.put(`${base}/due_at`, { due_at: new Date(a.set.due_at).toISOString() });
          if (a.set.assignees)
            await ctx.client.put(`${base}/assignees`, {
              assignees: a.set.assignees.map((x) => ({ collaborator_id: x.id, collaborator_type: x.type === "group" ? "GROUP" : "USER", assigned_role: "ASSIGNEE" })),
            });
          results.updated++;
        } catch (e) {
          results.failed.push({ id: t.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { summary: `Updated ${results.updated} of ${targets.length} actions.${results.failed.length ? ` ${results.failed.length} failed.` : ""}`, data: results };
    },
  }),

  defineTool({
    name: "sc_delete_actions",
    title: "Delete actions",
    toolset: "actions",
    access: "destructive",
    description: "Permanently deletes up to 100 actions by ID. This cannot be undone from the API.",
    input: { action_ids: z.array(z.string()).min(1).max(100), reason },
    plan: async ({ action_ids }, ctx) => {
      const rows = await Promise.all(
        action_ids.slice(0, 15).map((id) =>
          ctx.client
            .get<{ action?: { task: RawTask } }>(`/tasks/v1/actions/${encodeURIComponent(id)}`)
            .then((r) => (r.action?.task ? projectAction(r.action.task, ctx.now()) : { id, title: "(not found)" }))
            .catch(() => ({ id, title: "(not found or no access)" })),
        ),
      );
      return {
        summary: `${action_ids.length} actions would be permanently deleted.`,
        data: { count: action_ids.length, sample: rows },
        untrusted: true,
      };
    },
    run: async ({ action_ids }, ctx) => {
      await ctx.client.post("/tasks/v1/actions/delete", { ids: action_ids });
      return { summary: `Deleted ${action_ids.length} actions.`, data: { deleted: action_ids } };
    },
  }),
];

function describeSet(set: Record<string, unknown>) {
  return Object.entries(set)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} -> ${Array.isArray(v) ? `${v.length} assignee(s)` : String(v)}`)
    .join(", ");
}

async function resolveTargets(
  a: { action_ids?: string[]; filters?: Partial<ListFilters> },
  ctx: ToolContext,
): Promise<ReturnType<typeof projectAction>[]> {
  if (a.action_ids?.length && a.filters) throw new ToolError("Pass either action_ids or filters, not both.");
  if (a.action_ids?.length) {
    return Promise.all(
      a.action_ids.map((id) =>
        ctx.client
          .get<{ action?: { task: RawTask } }>(`/tasks/v1/actions/${encodeURIComponent(id)}`)
          .then((r) => projectAction(r.action!.task, ctx.now())),
      ),
    );
  }
  if (!a.filters || !Object.values(a.filters).some((v) => v !== undefined && !(Array.isArray(v) && !v.length)))
    throw new ToolError("Refusing to bulk-update every action in the organisation. Pass action_ids or at least one filter.");
  const got = await collectActions(ctx, a.filters, 201);
  if (got.items.length > 200) throw new ToolError(`Those filters select more than 200 actions. Narrow them, or run several batches.`);
  return got.items.map((t) => projectAction(t, ctx.now()));
}
