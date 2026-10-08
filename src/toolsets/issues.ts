import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { countBy, links, P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";

/**
 * Toolset "issues" (the API still calls them incidents under /incidents/ paths).
 * Mirrors the shape of src/toolsets/actions.ts: compact projections, one
 * patch-style update tool, destructive deletes behind a dry-run plan.
 *
 * Verified against the cached API reference 2026-10-08
 * (node scripts/api-ref.mjs incidentsservice_*):
 * - Issues have two system statuses: open 547ed646-... / resolved 450484b1-...
 * - Issue priorities are hardcoded UUIDs (none/low/medium/high).
 * - List/count duration filters are flat { from, to } ISO strings.
 * - The current Create Issue endpoint is POST /tasks/v1/incidents/submit
 *   (not the legacy POST /tasks/v1/incidents); it accepts no priority,
 *   due date or assignees, so sc_create_issue applies those with the
 *   per-field update endpoints afterwards and reports each one.
 */

export const ISSUE_STATUS = {
  open: "547ed646-5e34-4732-bb54-a199d304368a",
  resolved: "450484b1-56cd-4784-9b49-a3cf97d0c0ad",
} as const;
export const ISSUE_PRIORITY = {
  none: "58941717-817f-4c7c-a6f6-5cd05e2bbfde",
  low: "16ba4717-adc9-4d48-bf7c-044cfe0d2727",
  medium: "ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055",
  high: "02eb40c1-4f46-40c5-be16-d32941c96ec9",
} as const;
const STATUS_NAMES = Object.fromEntries(Object.entries(ISSUE_STATUS).map(([k, v]) => [v, k]));
const PRIORITY_NAMES = Object.fromEntries(Object.entries(ISSUE_PRIORITY).map(([k, v]) => [v, k]));

const status = z.enum(["open", "resolved"]);
const priority = z.enum(["none", "low", "medium", "high"]);
const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log; for new issues it is appended to the description.");
const assigneeList = z
  .array(z.object({ id: z.string(), type: z.enum(["user", "group"]).default("user") }))
  .optional()
  .describe("Assignees: user IDs (user_...) or group IDs. Find them with sc_search_users / sc_list_groups.");

interface RawCollaborator {
  collaborator_id?: string;
  collaborator_type?: string;
  assigned_role?: string;
  user?: { user_id?: string; firstname?: string; lastname?: string };
  group?: { group_id?: string; name?: string };
}

interface RawIssueTask {
  task_id: string;
  unique_id?: string;
  title?: string;
  description?: string;
  created_at?: string;
  modified_at?: string;
  due_at?: string;
  occurred_at?: string;
  completed_at?: string | null;
  priority_id?: string;
  status_id?: string;
  status?: { key?: string; label?: string };
  site?: { id?: string; name?: string };
  asset?: { id?: string; code?: string };
  inspection?: { inspection_id?: string; inspection_name?: string };
  inspection_item?: { inspection_item_id?: string; inspection_item_name?: string };
  creator?: { user_id?: string; firstname?: string; lastname?: string };
  collaborators?: RawCollaborator[];
}

interface RawIncident {
  task: RawIssueTask;
  category?: { id?: string; key?: string; label?: string; description?: string };
  inspections?: Array<{ id?: string; status?: string; title?: string; template_title?: string; created_at?: string }>;
  media?: Array<{ id?: string; filename?: string; media_type?: string }>;
  location?: { name?: string; locality?: string; administrative_area?: string; country?: string };
}

const fullName = (u?: { firstname?: string; lastname?: string }) => [u?.firstname, u?.lastname].filter(Boolean).join(" ") || undefined;

function projectAssignees(collaborators?: RawCollaborator[]) {
  return (collaborators ?? [])
    .filter((c) => c.assigned_role === "ASSIGNEE")
    .map((c) => (c.group ? { group: c.group.name, id: c.group.group_id } : { user: fullName(c.user), id: c.user?.user_id ?? c.collaborator_id }));
}

/** The compact shape every issue tool returns. */
export function projectIssue(incident: RawIncident) {
  const t = incident.task;
  return {
    id: t.task_id,
    ref: t.unique_id,
    title: t.title,
    category: incident.category?.id ? { id: incident.category.id, name: incident.category.label ?? incident.category.key } : undefined,
    status: STATUS_NAMES[t.status_id ?? ""] ?? t.status?.key?.toLowerCase() ?? t.status?.label ?? t.status_id,
    priority: PRIORITY_NAMES[t.priority_id ?? ""] ?? (t.priority_id ? "other" : "none"),
    site: t.site?.name ? { id: t.site.id, name: t.site.name } : undefined,
    occurred_at: t.occurred_at,
    created_at: t.created_at,
    due_at: t.due_at,
    assignees: projectAssignees(t.collaborators),
    link: links.issue(t.task_id),
  };
}

interface IssueListFilters {
  status?: z.infer<typeof status>[];
  priority?: z.infer<typeof priority>[];
  category_ids?: string[];
  site_ids?: string[];
  assignee_ids?: string[];
  period?: string;
  period_on?: "created" | "occurred";
}

type IssueFilter = Record<string, unknown>;

/** Translates friendly filters into the API's filters array. */
export function buildIssueFilters(f: IssueListFilters, now = new Date()): IssueFilter[] {
  const out: IssueFilter[] = [];
  if (f.status?.length) out.push({ status_id: { value: f.status.map((s) => ISSUE_STATUS[s]) } });
  if (f.priority?.length) out.push({ priority_id: { value: f.priority.map((p) => ISSUE_PRIORITY[p]) } });
  if (f.category_ids?.length) out.push({ category_id: { value: f.category_ids } });
  if (f.site_ids?.length) out.push({ site_id: { value: f.site_ids } });
  if (f.assignee_ids?.length) out.push({ assignee_id: { value: f.assignee_ids } });
  if (f.period) {
    const p = parsePeriod(f.period, now);
    const range = { from: p.from.toISOString(), to: p.to.toISOString() };
    out.push(f.period_on === "occurred" ? { occurred_at: range } : { created_at: range });
  }
  return out;
}

const listFilterInput = {
  status: z.array(status).optional().describe("Filter by status. Default: all statuses."),
  priority: z.array(priority).optional().describe("Filter by priority. Default: all priorities."),
  category_ids: z.array(z.string()).optional().describe("Only issues in these categories. Use sc_list_issue_categories to find IDs."),
  site_ids: P.siteIds,
  assignee_ids: z.array(z.string()).optional().describe("Only issues assigned to these user IDs."),
  period: z.string().optional().describe('Issues from this period, e.g. "last 30 days", "2026-Q3". Applies to created or occurred date (see period_on).'),
  period_on: z.enum(["created", "occurred"]).optional().describe("Which date period filters on. Default: created."),
};

async function listIssues(
  ctx: ToolContext,
  f: IssueListFilters,
  opts: { limit: number; sortField?: string; sortDirection?: string; pageToken?: string },
) {
  return ctx.client.post<{ incidents?: RawIncident[]; next_page_token?: string; total?: number }>("/tasks/v1/incidents/list", {
    page_size: Math.min(100, opts.limit),
    page_token: opts.pageToken,
    filters: buildIssueFilters(f, ctx.now()),
    sort_field: opts.sortField,
    sort_direction: opts.sortDirection,
  });
}

function toCollaborators(list: Array<{ id: string; type?: string }>) {
  return list.map((x) => ({
    collaborator_id: x.id,
    collaborator_type: x.type === "group" ? "GROUP" : "USER",
    assigned_role: "ASSIGNEE",
  }));
}

export const issuesTools = [
  defineTool({
    name: "sc_list_issues",
    title: "List issues",
    toolset: "issues",
    access: "read",
    core: true,
    description:
      "Lists issues (incidents) with filters (status, priority, category, site, assignee, created/occurred period). Returns compact rows with category, status, priority, site, dates, assignees and a web link, plus counts by status and category.",
    input: {
      ...listFilterInput,
      sort: z.enum(["due", "created", "modified", "occurred"]).optional().describe("Sort order. Default: newest modified first."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const sortField = { due: "DATE_DUE", created: "CREATED_AT", modified: "MODIFIED_AT", occurred: "OCCURRED_AT" }[a.sort ?? "modified"] ?? undefined;
      const res = await listIssues(ctx, a, {
        limit: a.limit ?? 50,
        pageToken: a.page_token,
        sortField,
        sortDirection: a.sort === "due" ? "ASC" : "DESC",
      });
      const rows = (res.incidents ?? []).map(projectIssue);
      return {
        summary: `${res.total ?? rows.length} issues match; showing ${rows.length}.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: {
          total: res.total,
          by_status: countBy(rows, (r) => r.status),
          by_category: countBy(rows, (r) => r.category?.name),
          issues: rows,
          next_page_token: res.next_page_token || undefined,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_issue",
    title: "Get issue",
    toolset: "issues",
    access: "read",
    core: true,
    description:
      "Gets one issue in full: description, status, priority, category, assignees, site, asset, the linked inspection, media, location, and the category questions with their answers.",
    input: { issue_id: P.issueId },
    run: async ({ issue_id }, ctx) => {
      const [res, qa] = await Promise.all([
        ctx.client.get<{ incident?: RawIncident }>(`/tasks/v1/incident/${encodeURIComponent(issue_id)}`),
        ctx.client.get<{
          questions_answers?: Array<{
            question?: { id?: string; text?: string; type?: string };
            is_answered?: boolean;
            answer_set?: Array<{ answer_text?: { text?: string }; answer_multiple_choice_option?: { text?: string }; answered_at?: string }>;
          }>;
        }>(`/tasks/v1/incidents/${encodeURIComponent(issue_id)}/questions_answers`),
      ]);
      const incident = res.incident;
      if (!incident?.task) throw new ToolError(`Issue ${issue_id} was not found.`);
      const t = incident.task;
      return {
        summary: `Issue "${t.title}" (${t.unique_id ?? issue_id}) is ${STATUS_NAMES[t.status_id ?? ""] ?? "in an unknown status"}.`,
        data: {
          ...projectIssue(incident),
          description: t.description,
          modified_at: t.modified_at,
          completed_at: t.completed_at ?? undefined,
          creator: fullName(t.creator),
          category_description: incident.category?.description,
          inspection: t.inspection?.inspection_id
            ? { id: t.inspection.inspection_id, name: t.inspection.inspection_name, item: t.inspection_item?.inspection_item_name }
            : undefined,
          linked_inspections: incident.inspections?.map((i) => ({ id: i.id, title: i.title, status: i.status, template: i.template_title })),
          asset: t.asset?.id ? { id: t.asset.id, code: t.asset.code } : undefined,
          media: incident.media?.map((m) => ({ id: m.id, filename: m.filename, type: m.media_type })),
          location: incident.location,
          questions_answers: (qa.questions_answers ?? []).map((x) => ({
            question: x.question?.text,
            answered: x.is_answered,
            answers: (x.answer_set ?? []).map((ans) => ans.answer_text?.text ?? ans.answer_multiple_choice_option?.text),
          })),
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_count_issues",
    title: "Count issues",
    toolset: "issues",
    access: "read",
    description: "Counts issues matching the same filters as sc_list_issues, without fetching them. Use it before a broad list to size the result.",
    input: { ...listFilterInput },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ total?: number }>("/tasks/v1/incidents/list/count", { filters: buildIssueFilters(a, ctx.now()) });
      return { summary: `${res.total ?? 0} issues match.`, data: { total: res.total ?? 0 } };
    },
  }),

  defineTool({
    name: "sc_list_issue_categories",
    title: "List issue categories",
    toolset: "issues",
    access: "read",
    description: "Lists the organisation's issue categories (ID and name). Call before filtering by category or creating an issue, which needs a category_id.",
    input: { limit: P.limit(100, 100), page_token: P.pageToken },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{
        categories?: Array<{ id?: string; key?: string; label?: string; description?: string }>;
        next_page_token?: string;
        total?: number;
      }>("/tasks/v1/customerconfiguration/categories", { page_size: Math.min(100, a.limit ?? 100), page_token: a.page_token });
      const rows = (res.categories ?? []).map((c) => ({ id: c.id, name: c.label ?? c.key, description: c.description }));
      return {
        summary: `${res.total ?? rows.length} issue categories.`,
        data: { total: res.total, categories: rows, next_page_token: res.next_page_token || undefined },
      };
    },
  }),

  defineTool({
    name: "sc_get_issue_timeline",
    title: "Get issue timeline",
    toolset: "issues",
    access: "read",
    description: "Lists the activity timeline of one issue: creation, status/priority/site/category changes, assignee changes and comments, newest last.",
    input: { issue_id: P.issueId },
    run: async ({ issue_id }, ctx) => {
      const res = await ctx.client.post<{
        timeline_items?: Array<{
          item_id?: string;
          item_type?: string;
          timestamp?: string;
          creator?: { firstname?: string; lastname?: string };
          task_comment_added_data?: { comment?: string };
          task_status_updated_data?: { status_id?: string };
          task_priority_updated_data?: { priority_id?: string };
        }>;
      }>("/tasks/v1/timeline", { task_id: issue_id });
      const items = (res.timeline_items ?? []).map((e) => ({
        id: e.item_id,
        type: e.item_type,
        at: e.timestamp,
        by: fullName(e.creator),
        detail:
          e.task_comment_added_data?.comment ??
          (e.task_status_updated_data ? { status: STATUS_NAMES[e.task_status_updated_data.status_id ?? ""] ?? e.task_status_updated_data.status_id } : undefined) ??
          (e.task_priority_updated_data
            ? { priority: PRIORITY_NAMES[e.task_priority_updated_data.priority_id ?? ""] ?? e.task_priority_updated_data.priority_id }
            : undefined),
      }));
      return {
        summary: `Issue has ${items.length} timeline events.`,
        data: { id: issue_id, events: items },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_issue_report",
    title: "Get issue PDF report",
    toolset: "issues",
    access: "read",
    description: "Returns a download URL for one issue's PDF report (the URL expires) and the issue's app link. To create a public web link, use sc_create_issue_share_link.",
    input: { issue_id: P.issueId },
    run: async ({ issue_id }, ctx) => {
      const pdf = await ctx.client.get<{ url?: string }>(`/tasks/v1/incidents/${encodeURIComponent(issue_id)}/pdf_report`);
      return {
        summary: "Generated the issue's PDF report link.",
        data: { id: issue_id, pdf_url: pdf.url, link: links.issue(issue_id) },
      };
    },
  }),

  defineTool({
    name: "sc_create_issue_share_link",
    title: "Create public issue web report link",
    toolset: "issues",
    access: "write",
    description: "Creates a public web report link for one issue. Anyone holding the link can view the report without signing in, so only create one when the user asks to share it.",
    input: { issue_id: P.issueId },
    run: async ({ issue_id }, ctx) => {
      const web = await ctx.client.post<{ url?: string }>(`/tasks/v1/shared_link/${encodeURIComponent(issue_id)}/web_report`, {});
      return {
        summary: "Created a public web report link. Treat it like a password: anyone with it can view the issue report.",
        data: { id: issue_id, web_report_url: web.url },
      };
    },
  }),

  defineTool({
    name: "sc_create_issue",
    title: "Create issue",
    toolset: "issues",
    access: "write",
    core: true,
    description:
      "Creates one issue (incident) with a title, category, description, site, occurred date and asset, then applies priority, due date and assignees. Returns the new issue's ID and link, plus which follow-up fields were applied.",
    input: {
      title: z.string().min(1).max(255),
      category_id: z.string().describe("Issue category ID. Use sc_list_issue_categories to find it."),
      description: z.string().max(500).optional().describe("Description (max 500 characters)."),
      site_id: z.string().optional(),
      occurred_at: z.string().datetime({ offset: true }).optional().describe("When the issue occurred, ISO 8601."),
      due_at: z.string().datetime({ offset: true }).optional().describe("Due date-time, ISO 8601. Applied after creation."),
      priority: priority.optional().describe("Applied after creation. Default: none."),
      assignees: assigneeList,
      reason,
    },
    run: async (a, ctx) => {
      const suffix = a.reason ? `\n\nRaised via safetyculture-mcp: ${a.reason}` : "";
      const description = [a.description ?? "", suffix].join("").trim().slice(0, 500) || undefined;
      const res = await ctx.client.post<{ incident_id?: string; unique_id?: string }>("/tasks/v1/incidents/submit", {
        title: a.title,
        category_id: a.category_id,
        description,
        site_id: a.site_id,
        occurred_at: a.occurred_at ? new Date(a.occurred_at).toISOString() : undefined,
      });
      if (!res.incident_id) throw new ToolError("The API accepted the request but returned no issue ID. Check the issues list before retrying, to avoid a duplicate.");
      const id = res.incident_id;
      const applied: string[] = ["title", "category"];
      const failed: Array<{ field: string; error: string }> = [];
      if (a.priority) {
        try {
          await ctx.client.put(`/tasks/v1/incidents/${encodeURIComponent(id)}/priority`, { priority_id: ISSUE_PRIORITY[a.priority] });
          applied.push("priority");
        } catch (e) {
          failed.push({ field: "priority", error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (a.due_at) {
        try {
          await ctx.client.put(`/tasks/v1/incidents/${encodeURIComponent(id)}/due_at`, { due_at: new Date(a.due_at).toISOString() });
          applied.push("due_at");
        } catch (e) {
          failed.push({ field: "due_at", error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (a.assignees?.length) {
        try {
          await ctx.client.post(`/tasks/v1/incidents/${encodeURIComponent(id)}/collaborators/add`, { collaborators: toCollaborators(a.assignees) });
          applied.push("assignees");
        } catch (e) {
          failed.push({ field: "assignees", error: e instanceof Error ? e.message : String(e) });
        }
      }
      return {
        summary: failed.length
          ? `Created issue "${a.title}" (${res.unique_id ?? id}); ${failed.length} follow-up fields failed (${failed.map((f) => f.field).join(", ")}).`
          : `Created issue "${a.title}" (${res.unique_id ?? id}).`,
        data: { id, ref: res.unique_id, applied, failed: failed.length ? failed : undefined, link: links.issue(id) },
      };
    },
  }),

  defineTool({
    name: "sc_update_issue",
    title: "Update issue",
    toolset: "issues",
    access: "write",
    core: true,
    idempotent: true,
    description:
      "Updates one issue. Pass only the fields to change: title, description, status, priority, due_at, occurred_at, site_id, category_id, asset_id, add_assignees or remove_assignees. Returns which fields changed.",
    input: {
      issue_id: P.issueId,
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(500).optional(),
      status: status.optional(),
      priority: priority.optional(),
      due_at: z.string().datetime({ offset: true }).nullable().optional().describe("New due date-time (ISO 8601), or null to clear it."),
      occurred_at: z.string().datetime({ offset: true }).optional(),
      site_id: z.string().optional(),
      category_id: z.string().optional(),
      asset_id: z.string().optional(),
      add_assignees: assigneeList,
      remove_assignees: assigneeList,
      reason,
    },
    run: async (a, ctx) => {
      const id = encodeURIComponent(a.issue_id);
      const base = `/tasks/v1/incidents/${id}`;
      const calls: Array<[string, () => Promise<unknown>]> = [];
      if (a.title !== undefined) calls.push(["title", () => ctx.client.put(`${base}/title`, { title: a.title })]);
      if (a.description !== undefined) calls.push(["description", () => ctx.client.put(`${base}/description`, { description: a.description })]);
      if (a.status) calls.push(["status", () => ctx.client.put(`${base}/status`, { status_id: ISSUE_STATUS[a.status!] })]);
      if (a.priority) calls.push(["priority", () => ctx.client.put(`${base}/priority`, { priority_id: ISSUE_PRIORITY[a.priority!] })]);
      if (a.due_at !== undefined)
        calls.push(["due_at", () => ctx.client.put(`${base}/due_at`, a.due_at ? { due_at: new Date(a.due_at).toISOString() } : {})]);
      const occurredAt = a.occurred_at;
      if (occurredAt !== undefined) calls.push(["occurred_at", () => ctx.client.put(`${base}/occurred_at`, { occurred_at: new Date(occurredAt).toISOString() })]);
      if (a.site_id !== undefined) calls.push(["site", () => ctx.client.put(`${base}/site`, { site_id: { value: a.site_id } })]);
      if (a.category_id !== undefined) calls.push(["category", () => ctx.client.put(`${base}/category`, { category_id: a.category_id })]);
      if (a.asset_id !== undefined) calls.push(["asset", () => ctx.client.put(`${base}/asset`, { asset_id: { value: a.asset_id } })]);
      if (a.add_assignees?.length)
        calls.push(["add_assignees", () => ctx.client.post(`${base}/collaborators/add`, { collaborators: toCollaborators(a.add_assignees!) })]);
      if (a.remove_assignees?.length)
        calls.push(["remove_assignees", () => ctx.client.post(`${base}/collaborators/remove`, { collaborators: toCollaborators(a.remove_assignees!) })]);
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
        data: { id: a.issue_id, changed, failed: failed.length ? failed : undefined, link: links.issue(a.issue_id) },
      };
    },
  }),

  defineTool({
    name: "sc_comment_on_issue",
    title: "Comment on issue",
    toolset: "issues",
    access: "write",
    description: "Adds a text comment to one issue's timeline. The comment is visible to anyone with access to the issue.",
    input: {
      issue_id: P.issueId,
      comment: z.string().min(1).max(5000).describe("The comment text."),
      reason,
    },
    run: async (a, ctx) => {
      await ctx.client.post("/tasks/v1/timeline/comments", { task_id: a.issue_id, comment: a.comment });
      return {
        summary: "Added the comment to the issue.",
        data: { id: a.issue_id, link: links.issue(a.issue_id) },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_delete_issues",
    title: "Delete issues",
    toolset: "issues",
    access: "destructive",
    description: "Permanently deletes up to 100 issues by ID. This cannot be undone from the API.",
    input: { issue_ids: z.array(z.string()).min(1).max(100), reason },
    plan: async ({ issue_ids }, ctx) => {
      const rows = await Promise.all(
        issue_ids.slice(0, 15).map((id) =>
          ctx.client
            .get<{ incident?: RawIncident }>(`/tasks/v1/incident/${encodeURIComponent(id)}`)
            .then((r) => (r.incident?.task ? projectIssue(r.incident) : { id, title: "(not found)" }))
            .catch(() => ({ id, title: "(not found or no access)" })),
        ),
      );
      return {
        summary: `${issue_ids.length} issues would be permanently deleted.`,
        data: { count: issue_ids.length, sample: rows },
        untrusted: true,
      };
    },
    run: async ({ issue_ids }, ctx) => {
      await ctx.client.post("/tasks/v1/incidents/delete", { ids: issue_ids });
      return { summary: `Deleted ${issue_ids.length} issues.`, data: { deleted: issue_ids } };
    },
  }),
];
