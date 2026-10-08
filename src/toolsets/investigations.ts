import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";

/**
 * Toolset "investigations" (plus the OSHA injury-record endpoints that live
 * under the same /incidents/v1 API). Mirrors src/toolsets/actions.ts.
 *
 * Verified against the cached API reference 2026-10-08
 * (node scripts/api-ref.mjs investigationsservice_* / oshaservice_*):
 * - List endpoints use GET with query params; page_size is required.
 * - Updating an investigation is one PUT per operation:
 *   PUT /incidents/v1/investigations/{id} { operation: { set_title: ... } }.
 *   (The reference shows a single `operation` object per body, so the patch
 *   tool sends one call per field and reports per-field success/failure.)
 * - No investigation web-link format is verified against the live app, so
 *   these tools return no `link` field (see links.* in core/params.ts).
 * - OSHA cases are injury records: list/get return minimal projections and
 *   the free-text medical/narrative fields only with include_details: true.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface UserMeta {
  user_id?: string;
  display_name?: string;
}

interface RawInvestigation {
  investigation_id?: string;
  created_at?: string;
  modified_at?: string;
  title?: string;
  description?: string;
  status?: { status_id?: string; title?: string; title_localised?: { value?: string } };
  identifier?: { prefix?: string; sequence?: number; for_display?: string };
  creator?: UserMeta;
  owner?: UserMeta;
  category?: { category_id?: string; title?: string; description?: string };
  link_counts?: { total_actions?: number; open_actions?: number; closed_actions?: number };
  fields?: Array<{ field_id?: string; title?: string; text?: { text?: string } }>;
}

const personName = (u?: UserMeta) => u?.display_name;

interface LinkedTaskEntry {
  action?: { task?: { task_id?: string; unique_id?: string; title?: string } };
  issue?: { task?: { task_id?: string; unique_id?: string; title?: string } };
}
type LinkedTask = LinkedTaskEntry;
type LinkedIssue = LinkedTaskEntry;
interface LinkedInspection {
  inspection?: { id?: string; name?: string; completed?: boolean; archived?: boolean };
}
interface LinkedMedia {
  file?: { id?: string; filename?: string };
  uploaded_at?: string;
  uploaded_by?: UserMeta;
}

/** The compact shape every investigation tool returns. */
export function projectInvestigation(inv: RawInvestigation) {
  return {
    id: inv.investigation_id,
    ref: inv.identifier?.for_display,
    title: inv.title,
    status: inv.status?.title_localised?.value ?? inv.status?.title,
    category: inv.category?.category_id ? { id: inv.category.category_id, title: inv.category.title } : undefined,
    created_at: inv.created_at,
    modified_at: inv.modified_at,
    creator: personName(inv.creator),
    owner: personName(inv.owner),
  };
}

const sortMap = {
  created: "InvestigationsSortFieldCreatedAt",
  modified: "InvestigationsSortFieldModifiedAt",
  title: "InvestigationsSortFieldTitle",
  status: "InvestigationsSortFieldStatus",
} as const;

async function countLinked(ctx: ToolContext, investigationId: string, kind: "actions" | "inspections" | "issues" | "media") {
  const res = await ctx.client.get<{ count?: number }>(`/incidents/v1/investigations/${encodeURIComponent(investigationId)}/${kind}/count`);
  return res.count ?? 0;
}

// OSHA outcome/type codes from the GetCase reference (oshaservice_getcase).
const OSHA_OUTCOME = { 1: "death", 2: "days_away", 3: "job_transfer", 4: "other" } as const;
const OSHA_TYPE = { 1: "injury", 2: "skin_disorder", 3: "respiratory", 4: "poisoning", 5: "hearing_loss" } as const;

interface RawOshaCase {
  case_id?: string;
  establishment_id?: string;
  created_at?: string;
  modified_at?: string;
  year_of_filing?: number;
  case_number?: string;
  job_title?: string;
  date_of_incident?: string;
  incident_location?: string;
  incident_description?: string;
  incident_outcome?: number;
  type_of_incident?: number;
  dafw_num_away?: number;
  djtr_num_tr?: number;
  // Free-text medical / identity fields: only returned with include_details.
  nar_before_incident?: string;
  nar_what_happened?: string;
  nar_injury_illness?: string;
  nar_object_substance?: string;
  date_of_birth?: string;
  date_of_hire?: string;
  sex?: string;
  treatment_facility_type?: number;
  treatment_in_patient?: number;
  time_started_work?: string;
  time_of_incident?: string;
  time_unknown?: boolean;
  date_of_death?: string;
  employee_name?: string;
  employee_street_address?: string;
  employee_city?: string;
  employee_state?: string;
  employee_zip?: string;
  physician_name?: string;
  facility_name?: string;
  facility_street_address?: string;
  facility_city?: string;
  facility_state?: string;
  facility_zip?: string;
}

function projectOshaCaseMinimal(c: RawOshaCase) {
  return {
    case_id: c.case_id,
    case_number: c.case_number,
    establishment_id: c.establishment_id,
    year_of_filing: c.year_of_filing,
    date_of_incident: c.date_of_incident,
    job_title: c.job_title,
    incident_location: c.incident_location,
    outcome: (c.incident_outcome != null ? OSHA_OUTCOME[c.incident_outcome as keyof typeof OSHA_OUTCOME] : undefined) ?? c.incident_outcome,
    incident_type: (c.type_of_incident != null ? OSHA_TYPE[c.type_of_incident as keyof typeof OSHA_TYPE] : undefined) ?? c.type_of_incident,
    days_away: c.dafw_num_away,
    days_job_transfer: c.djtr_num_tr,
  };
}

function projectOshaCaseDetails(c: RawOshaCase) {
  return {
    narrative: {
      before_incident: c.nar_before_incident,
      what_happened: c.nar_what_happened,
      injury_illness: c.nar_injury_illness,
      object_substance: c.nar_object_substance,
    },
    employee: {
      name: c.employee_name,
      date_of_birth: c.date_of_birth,
      date_of_hire: c.date_of_hire,
      sex: c.sex,
      street_address: c.employee_street_address,
      city: c.employee_city,
      state: c.employee_state,
      zip: c.employee_zip,
    },
    treatment: {
      facility_type: c.treatment_facility_type,
      in_patient: c.treatment_in_patient,
      physician_name: c.physician_name,
      facility_name: c.facility_name,
      facility_street_address: c.facility_street_address,
      facility_city: c.facility_city,
      facility_state: c.facility_state,
      facility_zip: c.facility_zip,
    },
    time_started_work: c.time_started_work,
    time_of_incident: c.time_of_incident,
    time_unknown: c.time_unknown,
    date_of_death: c.date_of_death,
    incident_description: c.incident_description,
  };
}

export const investigationsTools = [
  defineTool({
    name: "sc_list_investigations",
    title: "List investigations",
    toolset: "investigations",
    access: "read",
    description:
      "Lists investigations with optional text search and filters (status, site, category). Returns compact rows with reference, title, status, category, owner and timestamps.",
    input: {
      search: z.string().optional().describe("Text to match against investigations."),
      status_ids: z.array(z.string()).optional().describe("Only investigations with these status IDs."),
      site_ids: P.siteIds,
      category_ids: z.array(z.string()).optional().describe("Only investigations in these categories."),
      sort: z.enum(["created", "modified", "title", "status"]).optional().describe("Sort field. Default: newest modified first."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{ results?: RawInvestigation[]; next_page_token?: string }>(
        "/incidents/v1/investigations",
        {
          search: a.search,
          "filters.status_ids.values": a.status_ids,
          "filters.site_ids.values": a.site_ids,
          "filters.category_ids.values": a.category_ids,
          "sort.field": a.sort ? sortMap[a.sort] : undefined,
          "sort.order": a.sort ? "InvestigationsSortOrderDesc" : undefined,
          page_size: Math.min(100, a.limit ?? 50),
          page_token: a.page_token,
        },
      );
      const rows = (res.results ?? []).map(projectInvestigation);
      return {
        summary: `Found ${rows.length} investigations.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { investigations: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_investigation",
    title: "Get investigation",
    toolset: "investigations",
    access: "read",
    description:
      "Gets one investigation in full: description, status, category, owner, custom fields, counts of linked records, and compact lists of the linked inspections, actions, issues and media.",
    input: { investigation_id: z.string().describe("Investigation ID (UUID).") },
    run: async ({ investigation_id }, ctx) => {
      const id = encodeURIComponent(investigation_id);
      const base = `/incidents/v1/investigations/${id}`;
      const [res, actionCount, inspectionCount, issueCount, mediaCount, actions, inspections, issues, media] = await Promise.all([
        ctx.client.get<{ investigation?: RawInvestigation }>(base),
        countLinked(ctx, investigation_id, "actions"),
        countLinked(ctx, investigation_id, "inspections"),
        countLinked(ctx, investigation_id, "issues"),
        countLinked(ctx, investigation_id, "media"),
        ctx.client
          .get<{ actions?: LinkedTask[] }>(`${base}/actions`, { page_size: 20 })
          .catch((): { actions?: LinkedTask[] } => ({ actions: [] })),
        ctx.client
          .get<{ inspections?: LinkedInspection[] }>(`${base}/inspections`, { page_size: 20 })
          .catch((): { inspections?: LinkedInspection[] } => ({ inspections: [] })),
        ctx.client
          .get<{ issues?: LinkedIssue[] }>(`${base}/issues`, { page_size: 20 })
          .catch((): { issues?: LinkedIssue[] } => ({ issues: [] })),
        ctx.client
          .get<{ media?: LinkedMedia[] }>(`${base}/media`, { page_size: 20 })
          .catch((): { media?: LinkedMedia[] } => ({ media: [] })),
      ]);
      const inv = res.investigation;
      if (!inv?.investigation_id) throw new ToolError(`Investigation ${investigation_id} was not found.`);
      return {
        summary: `Investigation "${inv.title}" (${inv.identifier?.for_display ?? investigation_id}): ${actionCount} actions, ${issueCount} issues, ${inspectionCount} inspections, ${mediaCount} media linked.`,
        data: {
          ...projectInvestigation(inv),
          description: inv.description,
          link_counts: inv.link_counts,
          custom_fields: (inv.fields ?? []).map((f) => ({ id: f.field_id, title: f.title, text: f.text?.text })),
          counts: { actions: actionCount, inspections: inspectionCount, issues: issueCount, media: mediaCount },
          linked_actions: (actions.actions ?? []).map((x) => ({ id: x.action?.task?.task_id, ref: x.action?.task?.unique_id, title: x.action?.task?.title })),
          linked_inspections: (inspections.inspections ?? []).map((x) => ({
            id: x.inspection?.id,
            name: x.inspection?.name,
            completed: x.inspection?.completed,
            archived: x.inspection?.archived,
          })),
          linked_issues: (issues.issues ?? []).map((x) => ({ id: x.issue?.task?.task_id, ref: x.issue?.task?.unique_id, title: x.issue?.task?.title })),
          linked_media: (media.media ?? []).map((x) => ({ id: x.file?.id, filename: x.file?.filename, uploaded_at: x.uploaded_at, uploaded_by: personName(x.uploaded_by) })),
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_create_investigation",
    title: "Create investigation",
    toolset: "investigations",
    access: "write",
    description:
      "Creates one investigation in a category, optionally with a title, an initial status and an originating issue it was raised from. Returns the new investigation's ID.",
    input: {
      title: z.string().min(1).max(500).optional(),
      category_id: z.string().describe("Investigation category ID (required by the API)."),
      status_id: z.string().optional().describe("Initial status ID. Omit for the category default."),
      issue_id: z.string().optional().describe("Issue (UUID) this investigation originates from."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ result?: { investigation_id?: string } }>("/incidents/v1/investigations", {
        title: a.title,
        category_id: a.category_id,
        initial_status_id: a.status_id,
        originated_from: a.issue_id ? [{ issue_id: a.issue_id }] : undefined,
      });
      if (!res.result?.investigation_id)
        throw new ToolError("The API accepted the request but returned no investigation ID. Check the investigations list before retrying, to avoid a duplicate.");
      return {
        summary: `Created investigation "${a.title ?? res.result.investigation_id}".`,
        data: { id: res.result.investigation_id },
      };
    },
  }),

  defineTool({
    name: "sc_update_investigation",
    title: "Update investigation",
    toolset: "investigations",
    access: "write",
    idempotent: true,
    description:
      "Updates one investigation. Pass only the fields to change: title, description, status_id, link/unlink actions, issues and inspections. Returns which fields changed.",
    input: {
      investigation_id: z.string().describe("Investigation ID (UUID)."),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(25_000).optional(),
      status_id: z.string().optional().describe("New status ID."),
      link_action_ids: z.array(z.string()).optional(),
      unlink_action_ids: z.array(z.string()).optional(),
      link_issue_ids: z.array(z.string()).optional(),
      unlink_issue_ids: z.array(z.string()).optional(),
      link_inspection_ids: z.array(z.string()).optional().describe("Inspection IDs (audit_...)."),
      unlink_inspection_ids: z.array(z.string()).optional(),
      reason,
    },
    run: async (a, ctx) => {
      const url = `/incidents/v1/investigations/${encodeURIComponent(a.investigation_id)}`;
      const op = (operation: Record<string, unknown>) => () => ctx.client.put(url, { operation });
      const calls: Array<[string, () => Promise<unknown>]> = [];
      if (a.title !== undefined) calls.push(["title", op({ set_title: { title: a.title } })]);
      if (a.description !== undefined) calls.push(["description", op({ set_description: { description: a.description } })]);
      if (a.status_id !== undefined) calls.push(["status", op({ set_status: { status_id: a.status_id } })]);
      if (a.link_action_ids?.length) calls.push(["link_actions", op({ link_actions: { action_ids: a.link_action_ids } })]);
      if (a.unlink_action_ids?.length) calls.push(["unlink_actions", op({ unlink_actions: { action_ids: a.unlink_action_ids } })]);
      if (a.link_issue_ids?.length) calls.push(["link_issues", op({ link_issues: { issue_ids: a.link_issue_ids } })]);
      if (a.unlink_issue_ids?.length) calls.push(["unlink_issues", op({ unlink_issues: { issue_ids: a.unlink_issue_ids } })]);
      if (a.link_inspection_ids?.length) calls.push(["link_inspections", op({ link_inspections: { inspection_ids: a.link_inspection_ids } })]);
      if (a.unlink_inspection_ids?.length)
        calls.push(["unlink_inspections", op({ unlink_inspections: { inspection_ids: a.unlink_inspection_ids } })]);
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
        data: { id: a.investigation_id, changed, failed: failed.length ? failed : undefined },
      };
    },
  }),

  defineTool({
    name: "sc_list_osha_cases",
    title: "List OSHA cases",
    toolset: "investigations",
    access: "read",
    description:
      "Lists OSHA injury/illness cases with minimal fields (case number, establishment, year, date, outcome, job title). Free-text medical details are excluded; use sc_get_osha_case with include_details for those.",
    input: {
      establishment_id: z.string().optional().describe("Only cases for this establishment."),
      year_of_filing: z.number().int().optional().describe("Only cases filed in this year."),
      search: z.string().optional().describe("Search term to filter cases."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{ results?: RawOshaCase[]; next_page_token?: string }>("/incidents/v1/osha/cases", {
        establishment_id: a.establishment_id,
        year_of_filing: a.year_of_filing,
        search: a.search,
        page_size: Math.min(100, a.limit ?? 50),
        page_token: a.page_token,
      });
      const rows = (res.results ?? []).map(projectOshaCaseMinimal);
      return {
        summary: `Found ${rows.length} OSHA cases.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { cases: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_osha_case",
    title: "Get OSHA case",
    toolset: "investigations",
    access: "read",
    description:
      "Gets one OSHA injury/illness case. Returns minimal fields by default; pass include_details: true to also return the free-text narratives (what happened, injury description) and employee, physician and facility details.",
    input: {
      case_id: z.string().describe("OSHA case ID."),
      include_details: z.boolean().optional().describe("Include free-text medical narratives and employee/physician/facility details. Default: false."),
    },
    run: async ({ case_id, include_details }, ctx) => {
      const res = await ctx.client.get<{ case?: RawOshaCase }>(`/incidents/v1/osha/cases/${encodeURIComponent(case_id)}`);
      const c = res.case;
      if (!c?.case_id) throw new ToolError(`OSHA case ${case_id} was not found.`);
      return {
        summary: include_details
          ? `OSHA case ${c.case_number ?? case_id} with full details. Handle the medical and employee details as sensitive.`
          : `OSHA case ${c.case_number ?? case_id} (${String(projectOshaCaseMinimal(c).outcome ?? "unknown outcome")}).`,
        data: include_details ? { ...projectOshaCaseMinimal(c), details: projectOshaCaseDetails(c) } : projectOshaCaseMinimal(c),
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_osha_establishments",
    title: "List OSHA establishments",
    toolset: "investigations",
    access: "read",
    description: "Lists OSHA establishments (workplaces injury cases are filed against) with minimal fields: name, company and location.",
    input: {
      search: z.string().optional().describe("Search by name, company, city or industry."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{
        results?: Array<{ establishment_id?: string; establishment_name?: string; company_name?: string; city?: string; state?: string }>;
        next_page_token?: string;
      }>("/incidents/v1/osha/establishments", {
        search: a.search,
        page_size: Math.min(100, a.limit ?? 50),
        page_token: a.page_token,
      });
      const rows = (res.results ?? []).map((e) => ({
        establishment_id: e.establishment_id,
        name: e.establishment_name,
        company: e.company_name,
        city: e.city,
        state: e.state,
      }));
      return {
        summary: `Found ${rows.length} OSHA establishments.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { establishments: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),
];
