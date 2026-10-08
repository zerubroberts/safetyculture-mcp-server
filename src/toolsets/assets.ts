import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, errorMessage } from "../core/registry.js";

/**
 * Assets, asset types/fields and maintenance.
 * Contracts verified 2026-10-08 with `node scripts/api-ref.mjs <slug>`.
 * Uncertainty: PATCH /assets/v1/assets/{id} is sent with minimal bodies
 * (code-only / site-only); the docs show the full asset shape as the body
 * without spelling out partial-update semantics, so minimal PATCH bodies are
 * assumed to leave other fields untouched.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

const assetState = z.enum(["active", "archived"]);
const STATE_IDS = { active: "ASSET_STATE_ACTIVE", archived: "ASSET_STATE_ARCHIVED" } as const;

const friendly = (v: string | undefined, prefix: string) =>
  v && v.startsWith(prefix) ? v.slice(prefix.length).toLowerCase() : v;

interface RawField {
  field_id?: string;
  name?: string;
  string_value?: string;
  timestamp_value?: string;
  money_value?: { currency_code?: string; units?: string; nanos?: number };
}

interface RawAsset {
  id: string;
  code?: string;
  type?: { name?: string; type_id?: string };
  fields?: RawField[];
  site?: { id?: string; name?: string };
  state?: string;
  inspected_at?: string;
  modified_at?: string;
  statuses?: Array<{ name?: string }>;
  media?: unknown[];
}

function money(m: NonNullable<RawField["money_value"]>): string {
  const units = m.units ?? "0";
  const nanos = m.nanos ? `.${String(m.nanos).padStart(9, "0").replace(/0+$/, "")}` : "";
  return `${m.currency_code ?? ""} ${units}${nanos}`.trim();
}

function fieldValue(f: RawField): string | undefined {
  if (f.string_value !== undefined) return f.string_value;
  if (f.timestamp_value !== undefined) return f.timestamp_value;
  if (f.money_value) return money(f.money_value);
  return undefined;
}

/** Compact row shared by list and find tools. */
export function projectAsset(a: RawAsset) {
  return {
    id: a.id,
    code: a.code,
    type: a.type?.name,
    type_id: a.type?.type_id,
    site: a.site?.id ? { id: a.site.id, name: a.site.name } : undefined,
    state: friendly(a.state, "ASSET_STATE_"),
    status: a.statuses?.[0]?.name,
    inspected_at: a.inspected_at,
  };
}

/** Full detail: row plus flattened field values. */
export function projectAssetDetail(a: RawAsset) {
  return {
    ...projectAsset(a),
    fields: (a.fields ?? []).map((f) => ({ id: f.field_id, name: f.name, value: fieldValue(f) })),
    media_count: a.media?.length ?? 0,
    modified_at: a.modified_at,
  };
}

const fieldInput = z
  .object({
    field_id: z.string().optional().describe("Field ID from sc_list_asset_fields."),
    name: z.string().optional().describe("Field name (alternative to field_id)."),
    value: z.string().describe("String value to store. Only string-valued fields are supported."),
  })
  .describe("One field value to set.");

function toApiFields(fields: Array<{ field_id?: string; name?: string; value: string }>) {
  return fields.map((f) => {
    if (!f.field_id && !f.name) throw new ToolError("Each field needs a field_id or a name.");
    return { field_id: f.field_id, name: f.name, string_value: f.value };
  });
}

interface MaintenanceDetail {
  program_summary?: { id?: string; name?: string };
  plan_summary?: { id?: string; name?: string };
  service_status?: string;
  last_service?: { unit_value?: { value?: number; unit?: string }; timestamp?: string };
  last_service_timestamp?: string;
  next_service?: { unit_value?: { value?: number; unit?: string }; timestamp?: string };
  current_reading?: { unit_value?: { value?: number; unit?: string }; timestamp?: string };
  current_reading_timestamp?: string;
  due_in_value?: { unit_value?: { value?: number; unit?: string }; timestamp?: string };
  open_action_count?: number;
}

const metric = (m?: { unit_value?: { value?: number; unit?: string }; timestamp?: string }, at?: string) =>
  m || at ? { value: m?.unit_value?.value, unit: m?.unit_value?.unit, at: at ?? m?.timestamp } : undefined;

const SERVICE_HISTORY_PLANS = 5;

export const assetsTools = [
  defineTool({
    name: "sc_list_assets",
    title: "List assets",
    toolset: "assets",
    access: "read",
    description:
      "Lists assets with filters (asset type, site, active/archived state, text search). Returns compact rows with type, site, state and status. Use sc_get_asset for field values.",
    input: {
      type_id: z.string().optional().describe("Only assets of this type. Use sc_list_asset_types to find it."),
      site_id: z.string().optional().describe("Only assets assigned to this site. Use sc_list_sites to find it."),
      state: assetState.optional().describe("Only active or archived assets. Default: both."),
      text: z.string().optional().describe("Keywords matched against asset content."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const filters: Record<string, unknown>[] = [];
      if (a.type_id) filters.push({ type_id: a.type_id });
      if (a.site_id) filters.push({ site_id: a.site_id });
      if (a.state) filters.push({ state: STATE_IDS[a.state] });
      const res = await ctx.client.post<{ assets?: RawAsset[]; next_page_token?: string }>("/assets/v1/assets/list", {
        page_size: Math.min(100, a.limit ?? 50),
        page_token: a.page_token,
        search: a.text,
        asset_filters: filters.length ? filters : undefined,
      });
      const rows = (res.assets ?? []).map(projectAsset);
      return {
        summary: `Found ${rows.length} assets${res.next_page_token ? "; more available: pass page_token" : ""}.`,
        data: { assets: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_asset",
    title: "Get asset",
    toolset: "assets",
    access: "read",
    description: "Gets one asset in full: code, type, site, state, status and all field values. Find the ID with sc_list_assets or sc_find_asset.",
    input: { asset_id: z.string().describe("Asset ID (system-generated UUID).") },
    run: async ({ asset_id }, ctx) => {
      const res = await ctx.client.get<{ asset?: RawAsset }>(`/assets/v1/assets/${encodeURIComponent(asset_id)}`);
      if (!res.asset) throw new ToolError(`Asset ${asset_id} was not found.`);
      return {
        summary: `Asset "${res.asset.code ?? asset_id}" (${res.asset.type?.name ?? "unknown type"}).`,
        data: projectAssetDetail(res.asset),
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_find_asset",
    title: "Find asset by code or field value",
    toolset: "assets",
    access: "read",
    description:
      "Finds assets without knowing the system ID: either by exact asset code, or by an exact string field value such as a serial number or fleet ID (use sc_list_asset_fields to find field names). Pass code OR field_name plus field_value, not both.",
    input: {
      code: z.string().optional().describe("Exact user-defined asset code."),
      field_name: z.string().optional().describe("Asset field name to match (with field_value)."),
      field_value: z.string().optional().describe("Exact string value to match (with field_name)."),
    },
    run: async (a, ctx) => {
      const byField = a.field_name !== undefined || a.field_value !== undefined;
      if (a.code && byField) throw new ToolError("Pass either code or field_name plus field_value, not both.");
      if (a.code) {
        const res = await ctx.client.get<{ asset?: RawAsset }>("/assets/v1/assets:GetAssetByCode", { code: a.code });
        if (!res.asset) throw new ToolError(`No asset has code "${a.code}".`);
        return { summary: `Found asset "${a.code}".`, data: projectAssetDetail(res.asset), untrusted: true };
      }
      if (!a.field_name || !a.field_value)
        throw new ToolError("Pass either code or both field_name and field_value.");
      const res = await ctx.client.post<{ assets?: RawAsset[]; next_page_token?: string }>(
        "/assets/v1/assets:LookupAssetsByField",
        { field_name: a.field_name, string_value: a.field_value, page_size: 50 },
      );
      const rows = (res.assets ?? []).map(projectAsset);
      return {
        summary: `Found ${rows.length} assets where ${a.field_name} is "${a.field_value}".`,
        data: { assets: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_asset_types",
    title: "List asset types",
    toolset: "assets",
    access: "read",
    description:
      "Lists the organisation's asset types (ID, name, predefined or custom). Call before creating assets or filtering by type.",
    input: {
      text: z.string().optional().describe("Keywords to filter type names."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        type_list?: Array<{ id: string; name: string; type?: string }>;
        next_page_token?: string;
      }>("/assets/v1/types/list", {
        search: a.text,
        page_size: Math.min(100, a.limit ?? 50),
        page_token: a.page_token,
      });
      const rows = (res.type_list ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        category: friendly(t.type, "TYPE_CATEGORY_"),
      }));
      return {
        summary: `Found ${rows.length} asset types${res.next_page_token ? "; more available: pass page_token" : ""}.`,
        data: { types: rows, next_page_token: res.next_page_token || undefined },
      };
    },
  }),

  defineTool({
    name: "sc_list_asset_fields",
    title: "List asset fields",
    toolset: "assets",
    access: "read",
    description:
      "Lists the organisation's asset fields (ID, name, value type, select options). Call to resolve field IDs before setting field values on an asset.",
    input: { text: z.string().optional().describe("Filter fields by this search term.") },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        result?: Array<{
          id: string;
          name: string;
          field_type?: string;
          value_type?: string;
          select_options?: Array<{ id: string; label: string }>;
        }>;
      }>("/assets/v1/fields/list", { search: a.text });
      const rows = (res.result ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        field_type: friendly(f.field_type, "FIELD_TYPE_"),
        value_type: friendly(f.value_type, "FIELD_VALUE_TYPE_"),
        options: f.select_options?.map((o) => ({ id: o.id, label: o.label })),
      }));
      return { summary: `Found ${rows.length} asset fields.`, data: { fields: rows } };
    },
  }),

  defineTool({
    name: "sc_list_maintenance_programs",
    title: "List maintenance programs",
    toolset: "assets",
    access: "read",
    description:
      "Lists maintenance programs with asset and plan counts. Call before drilling into one asset's maintenance with sc_get_asset_maintenance.",
    input: { limit: P.limit(50, 100), page_token: P.pageToken },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        program_details?: Array<{
          program?: { id?: string; name?: string; description?: string };
          assets_count?: number;
          plans_count?: number;
        }>;
        next_page_token?: string;
      }>("/assets/v1/maintenance/program/details", {
        page_size: Math.min(100, a.limit ?? 50),
        page_token: a.page_token,
      });
      const rows = (res.program_details ?? []).map((p) => ({
        id: p.program?.id,
        name: p.program?.name,
        description: p.program?.description,
        assets_count: p.assets_count,
        plans_count: p.plans_count,
      }));
      return {
        summary: `Found ${rows.length} maintenance programs${res.next_page_token ? "; more available: pass page_token" : ""}.`,
        data: { programs: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_asset_maintenance",
    title: "Get asset maintenance and service history",
    toolset: "assets",
    access: "read",
    description:
      "Returns one asset's maintenance plans (program, service status, last/next service, open actions) plus recent service history per plan (latest first). Service history is fetched for up to 5 plans.",
    input: { asset_id: z.string().describe("Asset ID (system-generated UUID).") },
    run: async ({ asset_id }, ctx) => {
      const res = await ctx.client.post<{ details?: MaintenanceDetail[] }>("/assets/v1/maintenance/assets/details", {
        filter: { asset_ids: [asset_id] },
      });
      const details = res.details ?? [];
      const plans = await Promise.all(
        details.map(async (d) => {
          let recent: Array<{ at?: string; value?: number; unit?: string; by?: string }> | undefined;
          if (d.plan_summary?.id && details.indexOf(d) < SERVICE_HISTORY_PLANS) {
            const h = await ctx.client.post<{
              history?: Array<{
                service_date?: string;
                service_value?: { unit_value?: { value?: number; unit?: string } };
                user?: { name?: string };
              }>;
            }>(`/assets/v1/maintenance/asset/${encodeURIComponent(asset_id)}/service-history`, {
              plan_id: d.plan_summary.id,
              page_size: 5,
            });
            recent = (h.history ?? []).map((e) => ({
              at: e.service_date,
              value: e.service_value?.unit_value?.value,
              unit: e.service_value?.unit_value?.unit,
              by: e.user?.name,
            }));
          }
          return {
            program: d.program_summary?.name,
            program_id: d.program_summary?.id,
            plan: d.plan_summary?.name,
            plan_id: d.plan_summary?.id,
            status: friendly(d.service_status, "ASSET_SERVICE_STATUS_"),
            last_service: metric(d.last_service, d.last_service_timestamp),
            next_service: metric(d.next_service),
            current_reading: metric(d.current_reading, d.current_reading_timestamp),
            due_in: metric(d.due_in_value),
            open_actions: d.open_action_count,
            recent_service: recent,
          };
        }),
      );
      return {
        summary: details.length
          ? `Asset has ${details.length} maintenance plan${details.length === 1 ? "" : "s"}.`
          : "Asset has no maintenance plans.",
        data: { asset_id, plans, history_capped: details.length > SERVICE_HISTORY_PLANS || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_maintenance_status_counts",
    title: "Count assets by maintenance status",
    toolset: "assets",
    access: "read",
    description:
      "Counts assets in each maintenance status (scheduled, due soon, overdue, data missing), optionally filtered by site, program or text. Use for a quick maintenance overview.",
    input: {
      site_id: z.string().optional().describe("Only assets assigned to this site."),
      program_id: z.string().optional().describe("Only assets in this maintenance program."),
      text: z.string().optional().describe("Keywords to filter assets."),
    },
    run: async (a, ctx) => {
      const filter: Record<string, string[]> = {};
      if (a.site_id) filter.site_ids = [a.site_id];
      if (a.program_id) filter.program_ids = [a.program_id];
      const res = await ctx.client.post<{
        scheduled_count?: number;
        due_soon_count?: number;
        overdue_count?: number;
        data_missing_count?: number;
      }>("/assets/v1/maintenance/assets/status-counts", {
        filter: Object.keys(filter).length ? filter : undefined,
        search: a.text,
      });
      const counts = {
        scheduled: res.scheduled_count ?? 0,
        due_soon: res.due_soon_count ?? 0,
        overdue: res.overdue_count ?? 0,
        data_missing: res.data_missing_count ?? 0,
      };
      const total = counts.scheduled + counts.due_soon + counts.overdue + counts.data_missing;
      return {
        summary: `${total} assets: ${counts.overdue} overdue, ${counts.due_soon} due soon, ${counts.scheduled} scheduled, ${counts.data_missing} missing data.`,
        data: { ...counts, total },
      };
    },
  }),

  defineTool({
    name: "sc_create_asset",
    title: "Create asset",
    toolset: "assets",
    access: "write",
    description:
      "Creates one asset of an existing type, optionally with a code, site, string field values and a status option. Returns the new asset's ID.",
    input: {
      type_id: z.string().describe("Asset type ID. Use sc_list_asset_types to find it."),
      code: z.string().optional().describe("Your own unique identifier for the asset (must be unique per organisation)."),
      site_id: z.string().optional().describe("Site to assign the asset to. Use sc_list_sites to find it."),
      fields: z.array(fieldInput).optional().describe("String field values to set. Use sc_list_asset_fields to find IDs."),
      status_option_id: z
        .string()
        .optional()
        .describe("Status option to assign (must belong to the type's status group; at most one)."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ id?: string }>("/assets/v1/assets", {
        type_id: a.type_id,
        code: a.code,
        site: a.site_id,
        fields: a.fields ? toApiFields(a.fields) : undefined,
        status_option_ids: a.status_option_id ? [a.status_option_id] : undefined,
      });
      if (!res.id)
        throw new ToolError("The API accepted the request but returned no asset ID. Check the asset list before retrying, to avoid a duplicate.");
      return { summary: `Created asset${a.code ? ` "${a.code}"` : ""}.`, data: { id: res.id } };
    },
  }),

  defineTool({
    name: "sc_update_asset",
    title: "Update asset",
    toolset: "assets",
    access: "write",
    idempotent: true,
    description:
      "Patches one asset. Pass only the fields to change: code, site_id, field_values (string values, merged not replaced) and/or latitude plus longitude. Returns which groups changed.",
    input: {
      asset_id: z.string().describe("Asset ID (system-generated UUID)."),
      code: z.string().optional().describe("New user-defined code."),
      site_id: z.string().optional().describe("Move the asset to this site."),
      field_values: z.array(fieldInput).optional().describe("String field values to set (only these change)."),
      latitude: z.number().min(-90).max(90).optional().describe("New latitude (requires longitude)."),
      longitude: z.number().min(-180).max(180).optional().describe("New longitude (requires latitude)."),
      reason,
    },
    run: async (a, ctx) => {
      const id = encodeURIComponent(a.asset_id);
      if ((a.latitude === undefined) !== (a.longitude === undefined))
        throw new ToolError("Pass latitude and longitude together.");
      const calls: Array<[string, () => Promise<unknown>]> = [];
      if (a.code !== undefined) calls.push(["code", () => ctx.client.patch(`/assets/v1/assets/${id}`, { code: a.code })]);
      if (a.site_id !== undefined)
        calls.push(["site", () => ctx.client.patch(`/assets/v1/assets/${id}`, { site: { id: a.site_id } })]);
      if (a.field_values !== undefined)
        calls.push([
          "field_values",
          () => ctx.client.patch(`/assets/v1/assets/${id}/fields`, { fields: toApiFields(a.field_values!) }),
        ]);
      if (a.latitude !== undefined)
        calls.push([
          "location",
          () =>
            ctx.client.patch(`/assets/v1/assets/${id}/location`, {
              location: { geo_position: { latitude: a.latitude, longitude: a.longitude } },
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
          failed.push({ field, error: errorMessage(e, ctx.config) });
        }
      }
      return {
        summary: failed.length
          ? `Updated ${changed.length} of ${calls.length} groups; ${failed.length} failed (${failed.map((f) => f.field).join(", ")}).`
          : `Updated ${changed.join(", ")}.`,
        data: { id: a.asset_id, changed, failed: failed.length ? failed : undefined },
      };
    },
  }),

  defineTool({
    name: "sc_archive_asset",
    title: "Archive asset",
    toolset: "assets",
    access: "destructive",
    description:
      "Archives one asset so it can no longer be selected in inspections. The data is kept and the asset can be restored from the Mitti web app.",
    input: { asset_id: z.string().describe("Asset ID (system-generated UUID)."), reason },
    plan: async ({ asset_id }, ctx) => {
      const res = await ctx.client.get<{ asset?: RawAsset }>(`/assets/v1/assets/${encodeURIComponent(asset_id)}`);
      if (!res.asset) throw new ToolError(`Asset ${asset_id} was not found.`);
      const row = projectAsset(res.asset);
      return {
        summary: `Asset "${row.code ?? asset_id}" (${row.type ?? "unknown type"}) would be archived.`,
        data: { asset: row },
        untrusted: true,
      };
    },
    run: async ({ asset_id }, ctx) => {
      const res = await ctx.client.patch<{ id?: string; operation_id?: string }>(
        `/assets/v1/assets/${encodeURIComponent(asset_id)}/archive`,
        {},
      );
      return { summary: `Archived asset ${res.id ?? asset_id}.`, data: { id: res.id ?? asset_id } };
    },
  }),
];
