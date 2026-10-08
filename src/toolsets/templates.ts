import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";

/**
 * Templates toolset (ticket W1).
 *
 * Endpoint contracts verified with `node scripts/api-ref.mjs` on 2026-10-08:
 * - list: GET /templates/search (thepubservice_searchtemplates). It has no name
 *   filter, so name search is a case-insensitive client-side substring match.
 * - get: GET /templates/integration/v1/templates/{id}/definition
 *   (templateservice_gettemplatedefinition): metadata plus a flat item list
 *   (label, type, parent_id) and response sets in one call.
 * - response sets: GET /response_sets/v2 (list) and GET /response_sets/{id} (get).
 * - archive: POST /templates/v1/templates/{id}/archive;
 *   restore: DELETE /templates/v1/templates/{id}/archive.
 *
 * Template IDs are passed through unchanged.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface TemplateItem {
  item_id?: string;
  type?: string;
  label?: string;
  parent_id?: string;
  question_item?: { response_set_id?: string };
  [key: string]: unknown;
}

interface TemplateDefinition {
  template_identity?: { template_id?: string };
  template_name?: string;
  description?: string;
  version?: string;
  items?: TemplateItem[];
  response_sets?: {
    template_response_sets?: Array<{ response_set_id?: string; responses?: Array<{ id?: string; label?: string; short_label?: string; value?: string }> }>;
    global_response_sets?: Array<{ response_set_id?: string }>;
  };
}

async function fetchDefinition(ctx: ToolContext, templateId: string): Promise<TemplateDefinition> {
  const res = await ctx.client.get<{ template?: TemplateDefinition }>(
    `/templates/integration/v1/templates/${encodeURIComponent(templateId)}/definition`,
  );
  if (!res.template) throw new ToolError(`Template ${templateId} was not found.`);
  return res.template;
}

/** Item types that only structure the template (no answer of their own). */
const CONTAINER_TYPES = new Set([
  "ITEM_TYPE_PAGE",
  "ITEM_TYPE_APPROVAL_PAGE",
  "ITEM_TYPE_SECTION",
  "ITEM_TYPE_REPEATED_SECTION",
  "ITEM_TYPE_LOGIC",
  "ITEM_TYPE_TABLE",
  "ITEM_TYPE_TABLE_PAGE",
  "ITEM_TYPE_INFORMATION",
]);

function outlineQuestions(t: TemplateDefinition, cap: number) {
  const items = t.items ?? [];
  const byId = new Map(items.filter((i) => i.item_id).map((i) => [i.item_id!, i]));
  const sets = new Map((t.response_sets?.template_response_sets ?? []).map((s) => [s.response_set_id, s.responses ?? []]));
  const pathOf = (it: TemplateItem): string | undefined => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let parent = it.parent_id;
    for (let depth = 0; depth < 10 && parent && !seen.has(parent); depth++) {
      seen.add(parent);
      const p = byId.get(parent);
      if (!p) break;
      if (p.label) parts.unshift(p.label);
      parent = p.parent_id;
    }
    return parts.length ? parts.join(" > ") : undefined;
  };
  const questions = items.filter((i) => i.label && !CONTAINER_TYPES.has(i.type ?? ""));
  return {
    total: questions.length,
    questions: questions.slice(0, cap).map((i) => {
      const setId = i.question_item?.response_set_id;
      const options = setId ? sets.get(setId)?.map((r) => r.label ?? r.short_label ?? r.value ?? r.id) : undefined;
      return {
        item_id: i.item_id,
        section: pathOf(i),
        label: i.label,
        type: i.type,
        options: options?.length ? options : undefined,
        global_response_set: options?.length ? undefined : setId,
      };
    }),
  };
}

function parseOffset(pageToken: string | undefined): number {
  if (pageToken === undefined) return 0;
  if (/^\d+$/.test(pageToken)) return Number(pageToken);
  throw new ToolError(`Invalid page_token "${pageToken}". Pass back the next_page_token from a previous call unchanged.`);
}

export const templatesTools = [
  defineTool({
    name: "sc_list_templates",
    title: "List templates",
    toolset: "templates",
    access: "read",
    core: true,
    description:
      "Lists inspection templates, optionally matching a name fragment (case-insensitive) and including archived ones. Returns compact rows with modification dates.",
    input: {
      name: z.string().optional().describe("Only templates whose name contains this text (case-insensitive)."),
      include_archived: z.boolean().optional().describe("Include archived templates. Default: active only."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const offset = parseOffset(a.page_token);
      const limit = a.limit ?? 50;
      const res = await ctx.client.get<{
        templates?: Array<{ template_id?: string; name?: string; modified_at?: string; created_at?: string }>;
      }>("/templates/search", {
        field: ["template_id", "name", "modified_at", "created_at"],
        archived: a.include_archived ? "both" : "false",
        order: "desc",
        limit: 1000,
      });
      let rows = res.templates ?? [];
      if (a.name) {
        const needle = a.name.toLowerCase();
        rows = rows.filter((t) => t.name?.toLowerCase().includes(needle));
      }
      const page = rows.slice(offset, offset + limit).map((t) => ({ id: t.template_id, name: t.name, modified_at: t.modified_at, created_at: t.created_at }));
      const next = offset + limit < rows.length ? String(offset + limit) : undefined;
      return {
        summary: `${rows.length} templates match; showing ${page.length}.${next ? " More available: pass next_page_token." : ""}`,
        data: { total: rows.length, templates: page, next_page_token: next },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_template",
    title: "Get template",
    toolset: "templates",
    access: "read",
    core: true,
    description:
      "Gets one template's metadata plus a compact question outline (section path, label, type, response options). The outline is capped at 100 questions; response options from shared global sets are referenced by ID.",
    input: { template_id: z.string().describe("Template ID (template_...). Use sc_list_templates to find it.") },
    run: async ({ template_id }, ctx) => {
      const t = await fetchDefinition(ctx, template_id);
      const outline = outlineQuestions(t, 100);
      return {
        summary: `Template "${t.template_name}" has ${outline.total} questions${outline.total > outline.questions.length ? `; outline capped at ${outline.questions.length}.` : "."}`,
        data: {
          id: t.template_identity?.template_id ?? template_id,
          name: t.template_name,
          description: t.description,
          version: t.version,
          question_count: outline.total,
          questions: outline.questions,
          global_response_sets: t.response_sets?.global_response_sets?.map((s) => s.response_set_id),
          outline_capped: outline.total > outline.questions.length ? `Showing ${outline.questions.length} of ${outline.total} questions.` : undefined,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_response_sets",
    title: "List global response sets",
    toolset: "templates",
    access: "read",
    description:
      "Lists the organisation's global (shared) response sets: the reusable Yes/No/Yes-No-N/A option lists templates refer to. Get one set's options with sc_get_response_set.",
    input: { limit: P.limit(50, 100) },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{ response_sets?: Array<{ responseset_id?: string; name?: string; created_at?: string }> }>(
        "/response_sets/v2",
        { limit: a.limit ?? 50 },
      );
      const rows = (res.response_sets ?? []).map((s) => ({ id: s.responseset_id, name: s.name, created_at: s.created_at }));
      return { summary: `${rows.length} global response sets.`, data: { total: rows.length, response_sets: rows }, untrusted: true };
    },
  }),

  defineTool({
    name: "sc_get_response_set",
    title: "Get global response set",
    toolset: "templates",
    access: "read",
    description: "Gets one global response set with all its response options (labels). Use to interpret the selected options in inspection answers.",
    input: { response_set_id: z.string().describe("Response set ID from sc_list_response_sets or a template outline.") },
    run: async ({ response_set_id }, ctx) => {
      const res = await ctx.client.get<{
        responseset_id?: string;
        name?: string;
        created_at?: string;
        updated_at?: string;
        responses?: Array<{ id?: string; label?: string; short_label?: string }>;
      }>(`/response_sets/${encodeURIComponent(response_set_id)}`);
      if (!res.responseset_id) throw new ToolError(`Response set ${response_set_id} was not found.`);
      return {
        summary: `Response set "${res.name}" has ${res.responses?.length ?? 0} options.`,
        data: {
          id: res.responseset_id,
          name: res.name,
          created_at: res.created_at,
          updated_at: res.updated_at,
          responses: (res.responses ?? []).map((r) => ({ id: r.id, label: r.label, short_label: r.short_label })),
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_restore_template",
    title: "Restore archived template",
    toolset: "templates",
    access: "write",
    description: "Restores an archived template back to the active list.",
    input: { template_id: z.string().describe("Archived template ID (template_...) to restore."), reason },
    run: async ({ template_id }, ctx) => {
      await ctx.client.delete(`/templates/v1/templates/${encodeURIComponent(template_id)}/archive`);
      return { summary: `Restored template ${template_id} from archive.`, data: { id: template_id } };
    },
  }),

  defineTool({
    name: "sc_archive_template",
    title: "Archive template",
    toolset: "templates",
    access: "destructive",
    description: "Archives one template so it leaves the active list. Reversible with sc_restore_template.",
    input: { template_id: z.string().describe("Template ID (template_...) to archive."), reason },
    plan: async ({ template_id }, ctx) => {
      const t = await fetchDefinition(ctx, template_id);
      return {
        summary: `Would archive template "${t.template_name}" (${t.items?.length ?? 0} items).`,
        data: { id: t.template_identity?.template_id ?? template_id, name: t.template_name, description: t.description, item_count: t.items?.length ?? 0 },
        untrusted: true,
      };
    },
    run: async ({ template_id }, ctx) => {
      await ctx.client.post(`/templates/v1/templates/${encodeURIComponent(template_id)}/archive`, {});
      return { summary: `Archived template ${template_id}. Restore it with sc_restore_template.`, data: { id: template_id } };
    },
  }),
];
