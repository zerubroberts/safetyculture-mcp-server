import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { ids, links, P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";

/**
 * Inspections toolset (ticket W1).
 *
 * Endpoint contracts verified with `node scripts/api-ref.mjs` on 2026-10-08:
 * - search/list: GET /feed/inspections (thepubservice_feedinspections). Server-side
 *   filters are template, archived, completed and modified_after/before only; site and
 *   owner are applied client-side after the feed is collected.
 * - header + answers: GET /inspections/v1/inspections/{id}/details
 *   (externalinspectionservice_getinspectiondetails) plus GET
 *   /inspections/v1/inspections/{id} (inspectionservice_getinspection) for duration.
 *   The streaming GET /inspections/v1/answers/{id} endpoint is deliberately NOT used:
 *   it returns concatenated JSON structures, not one JSON document, so a plain REST
 *   client cannot parse it. The details endpoint carries the same answer content.
 * - report links: GET /audits/{audit_id}/web_report_link + POST /audits/{audit_id}/deep_link.
 * - export: POST /inspection/v1/export (reportsservice_startinspectionexport). The call
 *   is synchronous server-side with a ~60 s timeout; a repeat with the same body
 *   continues an in-progress export, which is what the poll loop below does.
 * - media list: the `media` array on GET /inspections/v1/inspections/{id};
 *   download URL: GET /media/v1/download/{id} (mediaservice_getdownloadsignedurl).
 * - writes: POST /inspections/integration/v1/inspections (create), PUT .../owner
 *   ({owner_id}), PUT .../site ({site_id}), PUT ... (integration answer updates),
 *   POST .../complete, POST .../clone, POST /audits/{audit_id}/share,
 *   DELETE .../archive (restore), POST .../archive (archive),
 *   DELETE /inspections/v1/inspections/{id} (delete).
 *
 * ID forms: the v1 inspection endpoints accept either the prefixed (audit_...) or the
 * UUID form, so inspection IDs are passed through unchanged there. The legacy /audits/*
 * paths are normalised with ids.audit. Template, site, user and media IDs are always
 * passed through unchanged.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

const completed = z.enum(["true", "false", "any"]).optional().describe("Completion status. Default: any.");

interface FeedInspection {
  id?: string;
  name?: string;
  archived?: boolean;
  owner_id?: string;
  owner_name?: string;
  author_name?: string;
  site_id?: string;
  template_id?: string;
  template_name?: string;
  score?: number;
  max_score?: number;
  score_percentage?: number;
  date_started?: string;
  date_completed?: string;
  date_modified?: string;
  created_at?: string;
  modified_at?: string;
  location?: string;
}

function projectFeedRow(r: FeedInspection) {
  const id = r.id ?? "";
  return {
    id,
    name: r.name,
    template: { id: r.template_id, name: r.template_name },
    site_id: r.site_id,
    score_percentage: r.score_percentage,
    max_score: r.max_score,
    completed_at: r.date_completed,
    modified_at: r.date_modified ?? r.modified_at,
    owner: r.owner_name,
    location: r.location,
    link: id ? links.inspection(id) : undefined,
    report_link: id ? links.report(id) : undefined,
  };
}

function parseOffset(pageToken: string | undefined): number {
  if (pageToken === undefined) return 0;
  if (/^\d+$/.test(pageToken)) return Number(pageToken);
  throw new ToolError(`Invalid page_token "${pageToken}". Pass back the next_page_token from a previous call unchanged.`);
}

interface DetailsMetadata {
  inspection_id?: string;
  inspection_name?: string;
  created_time?: string;
  last_modified_time?: string;
  last_modified_by?: { id?: string; name?: string };
  completed_time?: string;
  is_marked_as_complete?: boolean;
  is_archived?: boolean;
  score?: { combined_score?: number; combined_max_score?: number; combined_score_percentage?: number };
  site?: { site_id?: string; site_name?: string };
  owner?: { id?: string; name?: string };
}

async function fetchHeader(ctx: ToolContext, id: string) {
  const [details, base] = await Promise.all([
    ctx.client.get<{ inspection?: { metadata?: DetailsMetadata; template?: { template_id?: string; template_name?: string } } }>(
      `/inspections/v1/inspections/${encodeURIComponent(id)}/details`,
    ),
    ctx.client
      .get<{ inspection?: { duration?: number; title?: string } }>(`/inspections/v1/inspections/${encodeURIComponent(id)}`)
      .catch(() => ({ inspection: undefined })),
  ]);
  const meta = details.inspection?.metadata;
  if (!meta?.inspection_id) throw new ToolError(`Inspection ${id} was not found.`);
  return { meta, template: details.inspection?.template, duration: base.inspection?.duration };
}

interface DetailItem {
  item_id?: string;
  type?: string;
  label?: string;
  parent_id?: string;
  flagged?: boolean;
  item_score?: { score?: number; max_score?: number; score_percentage?: number };
  text_item?: { text?: string };
  datetime_item?: { datetime?: string };
  address_item?: { location_text?: string };
  checkbox_item?: { checked?: boolean };
  list_items?: { responses?: Array<{ id?: string; value?: string }> };
  question_item?: { responses?: Array<{ id?: string; value?: string }> };
  media_item?: { media?: Array<{ id?: string }> };
  drawing_item?: { image?: unknown };
  signature_item?: { image?: unknown; name?: string };
  temperature_item?: { temperature?: number; scale?: string };
  slider_item?: { answer?: number };
  asset_item?: { asset_id?: string };
  site_item?: { id?: string; name?: string };
  attachments?: { note?: string; media?: unknown[] };
  [key: string]: unknown;
}

/** Sub-objects that carry an answer. Items with none of these are structural (sections, pages). */
const ANSWER_KEYS = [
  "text_item",
  "datetime_item",
  "address_item",
  "checkbox_item",
  "list_items",
  "question_item",
  "media_item",
  "drawing_item",
  "signature_item",
  "temperature_item",
  "slider_item",
  "asset_item",
  "site_item",
  "company_item",
  "table_item",
] as const;

function countMedia(it: DetailItem): number {
  let n = 0;
  if (Array.isArray(it.media_item?.media)) n += it.media_item.media.length;
  if (it.drawing_item?.image) n += 1;
  if (it.signature_item?.image) n += 1;
  if (Array.isArray(it.attachments?.media)) n += it.attachments.media.length;
  return n;
}

function responseText(it: DetailItem): string | undefined {
  if (it.text_item?.text !== undefined) return it.text_item.text;
  if (it.datetime_item?.datetime !== undefined) return it.datetime_item.datetime;
  if (it.address_item?.location_text !== undefined) return it.address_item.location_text;
  if (it.checkbox_item?.checked !== undefined) return it.checkbox_item.checked ? "Yes" : "No";
  const selected = it.question_item?.responses ?? it.list_items?.responses;
  if (selected) return selected.map((r) => r.value ?? r.id).filter(Boolean).join("; ") || undefined;
  if (it.signature_item?.name !== undefined) return it.signature_item.name;
  if (it.temperature_item?.temperature !== undefined)
    return `${it.temperature_item.temperature}${it.temperature_item.scale ? ` ${it.temperature_item.scale}` : ""}`;
  if (it.slider_item?.answer !== undefined) return String(it.slider_item.answer);
  if (it.asset_item?.asset_id !== undefined) return it.asset_item.asset_id;
  if (it.site_item?.name !== undefined || it.site_item?.id !== undefined) return it.site_item.name ?? it.site_item.id;
  return undefined;
}

/** Builds "Section > Subsection" paths by walking parent_id links between the detail items. */
function sectionPath(it: DetailItem, byId: Map<string, DetailItem>): string | undefined {
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
}

function projectAnswer(it: DetailItem, byId: Map<string, DetailItem>) {
  return {
    item_id: it.item_id,
    section: sectionPath(it, byId),
    parent_id: it.parent_id || undefined,
    label: it.label,
    type: it.type,
    response: responseText(it),
    failed: it.flagged === true,
    score: it.item_score?.score,
    max_score: it.item_score?.max_score,
    score_percentage: it.item_score?.score_percentage,
    note: it.attachments?.note || undefined,
    media_count: countMedia(it),
  };
}

function projectHeader(meta: DetailsMetadata, template: { template_id?: string; template_name?: string } | undefined, duration: number | undefined) {
  const id = meta.inspection_id ?? "";
  return {
    id,
    name: meta.inspection_name,
    template: { id: template?.template_id, name: template?.template_name },
    site: meta.site?.site_id ? { id: meta.site.site_id, name: meta.site.site_name } : undefined,
    owner: meta.owner?.id ? { id: meta.owner.id, name: meta.owner.name } : undefined,
    author: meta.last_modified_by?.name,
    score: meta.score
      ? { percentage: meta.score.combined_score_percentage, score: meta.score.combined_score, max_score: meta.score.combined_max_score }
      : undefined,
    is_complete: meta.is_marked_as_complete,
    completed_at: meta.completed_time,
    created_at: meta.created_time,
    modified_at: meta.last_modified_time,
    archived: meta.is_archived,
    duration_seconds: duration,
    link: id ? links.inspection(id) : undefined,
    report_link: id ? links.report(id) : undefined,
  };
}

export const inspectionsTools = [
  defineTool({
    name: "sc_search_inspections",
    title: "Search inspections",
    toolset: "inspections",
    access: "read",
    core: true,
    description:
      "Searches inspections by template, site, owner, completion and archive status. The period filters on the inspection's last-modified date (modified_at), not the date it was conducted or completed. Returns compact rows with score, owner, web links and completion date.",
    input: {
      template_ids: P.templateIds,
      site_ids: P.siteIds,
      period: P.period("last 30 days"),
      completed: completed,
      archived: z.boolean().optional().describe("Only archived inspections (true) or only active ones (default false)."),
      owner_id: P.userId,
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const p = parsePeriod(a.period, ctx.now());
      const offset = parseOffset(a.page_token);
      const limit = a.limit ?? 50;
      const res = await ctx.client.collectFeed<FeedInspection>(
        "/feed/inspections",
        {
          template: a.template_ids,
          archived: a.archived ? "true" : "false",
          completed: a.completed === undefined || a.completed === "any" ? "both" : a.completed,
          modified_after: p.from.toISOString(),
          modified_before: p.to.toISOString(),
        },
        // One extra record past the page so we know whether a next page exists.
        { maxItems: Math.min(2000, offset + limit + 1) },
      );
      let rows = res.items;
      if (a.site_ids?.length) rows = rows.filter((r) => r.site_id && a.site_ids!.includes(r.site_id));
      if (a.owner_id) rows = rows.filter((r) => r.owner_id === a.owner_id);
      const page = rows.slice(offset, offset + limit);
      const projected = page.map(projectFeedRow);
      const next = offset + limit < rows.length ? String(offset + limit) : undefined;
      return {
        summary: `${rows.length} inspections match; showing ${projected.length}.${next ? " More available: pass next_page_token." : ""}${res.truncated ? " Feed truncated at 2000 records: narrow the filters." : ""}`,
        data: { total: rows.length, inspections: projected, next_page_token: next, truncated: res.truncated || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_inspection",
    title: "Get inspection",
    toolset: "inspections",
    access: "read",
    core: true,
    description:
      "Gets one inspection's header: name, score, started/completed/modified dates, owner, last author, site, template, archive status and duration. For the question-by-question answers use sc_get_inspection_answers.",
    input: { inspection_id: P.inspectionId },
    run: async ({ inspection_id }, ctx) => {
      const { meta, template, duration } = await fetchHeader(ctx, inspection_id);
      const data = projectHeader(meta, template, duration);
      return {
        summary: `Inspection "${meta.inspection_name}" is ${meta.is_marked_as_complete ? "complete" : "incomplete"}${meta.is_archived ? " (archived)" : ""} with score ${meta.score?.combined_score_percentage ?? "unknown"}%.`,
        data,
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_inspection_answers",
    title: "Get inspection answers",
    toolset: "inspections",
    access: "read",
    core: true,
    description:
      "Returns one inspection's answers as flat rows: section path, question label, type, response text or selected options, failed flag, score, notes and media count. Repeated sections keep their grouping through parent_id. Use failed_only to see just the failed items.",
    input: {
      inspection_id: P.inspectionId,
      failed_only: z.boolean().optional().describe("Only return items with a failed response. Default: all answered items."),
      limit: P.limit(100, 500),
    },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{ inspection?: { items?: DetailItem[] } }>(
        `/inspections/v1/inspections/${encodeURIComponent(a.inspection_id)}/details`,
      );
      const items = res.inspection?.items ?? [];
      const byId = new Map(items.filter((i) => i.item_id).map((i) => [i.item_id!, i]));
      const answered = items.filter(
        (i) => ANSWER_KEYS.some((k) => i[k] !== undefined && i[k] !== null) || i.attachments?.note,
      );
      const filtered = a.failed_only ? answered.filter((i) => i.flagged === true) : answered;
      const limit = a.limit ?? 100;
      const page = filtered.slice(0, limit);
      const failed = filtered.filter((i) => i.flagged === true).length;
      return {
        summary: `${filtered.length} answers${a.failed_only ? " (failed only)" : ` (${failed} failed)`}; showing ${page.length}.${filtered.length > page.length ? " Capped by limit: raise it to see more." : ""}`,
        data: { total: filtered.length, failed, answers: page.map((i) => projectAnswer(i, byId)) },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_inspection_report_link",
    title: "Get inspection report link",
    toolset: "inspections",
    access: "read",
    core: true,
    description:
      "Returns the inspection's web report link (never expires until deleted) and a mobile deep link (expires about a year after creation). Use when someone needs to open the inspection in a browser or the Mitti app.",
    input: { inspection_id: P.inspectionId },
    run: async ({ inspection_id }, ctx) => {
      const auditId = ids.audit(inspection_id);
      const [web, deep] = await Promise.all([
        ctx.client.get<{ url?: string }>(`/audits/${encodeURIComponent(auditId)}/web_report_link`),
        ctx.client.post<{ url?: string }>(`/audits/${encodeURIComponent(auditId)}/deep_link`, {}),
      ]);
      return {
        summary: "Web report link is permanent until deleted; the app deep link expires about a year after creation.",
        data: { inspection_id, web_report_url: web.url, deep_link: deep.url, link: links.inspection(inspection_id) },
      };
    },
  }),

  defineTool({
    name: "sc_export_inspection_document",
    title: "Export inspection document",
    toolset: "inspections",
    access: "read",
    description:
      "Generates a PDF or Word report for one inspection. The export can take up to about a minute: this tool waits and retries the same request until the file is ready (bounded at 60 seconds). Returns the download URL, which expires, so download it promptly.",
    input: {
      inspection_id: P.inspectionId,
      format: z.enum(["pdf", "word"]).optional().describe("Document format. Default: pdf."),
    },
    run: async (a, ctx) => {
      const body = {
        export_data: [{ inspection_id: a.inspection_id }],
        type: a.format === "word" ? "DOCUMENT_TYPE_WORD" : "DOCUMENT_TYPE_PDF",
      };
      const deadline = Date.now() + 60_000;
      for (;;) {
        const res = await ctx.client.post<{ url?: string; status?: string }>("/inspection/v1/export", body);
        if (res.status === "STATUS_DONE" && res.url) {
          return {
            summary: "Export is ready. The download URL expires, so download it promptly.",
            data: { inspection_id: a.inspection_id, format: a.format ?? "pdf", status: "done", download_url: res.url },
          };
        }
        if (res.status === "STATUS_FAILED") throw new ToolError("The export failed on the Mitti side. Check the inspection has synced media, then try again.");
        if (Date.now() >= deadline) {
          return {
            summary: "Export is still running after 60 seconds. Call this tool again with the same arguments to continue waiting.",
            data: { inspection_id: a.inspection_id, format: a.format ?? "pdf", status: "in_progress" },
          };
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    },
  }),

  defineTool({
    name: "sc_list_inspection_media",
    title: "List inspection media",
    toolset: "inspections",
    access: "read",
    description:
      "Lists the photos, videos and files attached to one inspection. Pass a media id plus its token to sc_get_media_url to get a downloadable URL.",
    input: { inspection_id: P.inspectionId, limit: P.limit(50, 100) },
    run: async (a, ctx) => {
      const res = await ctx.client.get<{
        inspection?: { media?: Array<{ id?: string; token?: string; filename?: string; media_type?: string }> };
      }>(`/inspections/v1/inspections/${encodeURIComponent(a.inspection_id)}`);
      const all = res.inspection?.media ?? [];
      const limit = a.limit ?? 50;
      const page = all.slice(0, limit).map((m) => ({ id: m.id, filename: m.filename, media_type: m.media_type }));
      return {
        summary: `${all.length} media files on inspection ${a.inspection_id}; showing ${page.length}.`,
        data: { inspection_id: a.inspection_id, total: all.length, media: page },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_media_url",
    title: "Get media download URL",
    toolset: "inspections",
    access: "read",
    description:
      "Turns a media id plus its token (from sc_list_inspection_media or inspection answers) into a downloadable URL. Signed URLs expire quickly, so download immediately.",
    input: {
      media_id: z.string().describe("Media ID from the inspection's media list."),
      token: z.string().describe("Per-media access token returned alongside the media ID."),
      media_type: z
        .enum(["image", "video", "pdf", "word", "excel", "slides", "csv"])
        .optional()
        .describe("File kind. Needed for some downloads, especially video."),
      filename: z.string().optional().describe("Download the file as an attachment with this name."),
    },
    run: async (a, ctx) => {
      const kinds = {
        image: "MEDIA_TYPE_IMAGE",
        video: "MEDIA_TYPE_VIDEO",
        pdf: "MEDIA_TYPE_PDF",
        word: "MEDIA_TYPE_DOCX",
        excel: "MEDIA_TYPE_XLSX",
        slides: "MEDIA_TYPE_PPTX",
        csv: "MEDIA_TYPE_CSV",
      } as const;
      const res = await ctx.client.get<{ url?: string; download_info?: { mp4_info?: { url?: string }; stream_info?: { stream_url?: string } } }>(
        `/media/v1/download/${encodeURIComponent(a.media_id)}`,
        {
          token: a.token,
          media_type: a.media_type ? kinds[a.media_type] : undefined,
          download_as_attachment_name: a.filename,
        },
      );
      // `url` is set for download paths (deprecated only for uploads); videos additionally expose an MP4 URL.
      const url = res.url ?? res.download_info?.mp4_info?.url ?? res.download_info?.stream_info?.stream_url;
      if (!url) throw new ToolError("The API returned no download URL for that media. The token may have expired: list the media again for a fresh token.");
      return { summary: "Download URL is signed and expires quickly; download immediately.", data: { media_id: a.media_id, url } };
    },
  }),

  defineTool({
    name: "sc_start_inspection",
    title: "Start inspection",
    toolset: "inspections",
    access: "write",
    description:
      "Starts a new inspection from a template, optionally assigning it to a site. Returns the new inspection's ID and web link. Find template IDs with sc_list_templates.",
    input: {
      template_id: z.string().describe("Template ID (template_...) to start the inspection from."),
      site_id: z.string().optional().describe("Site ID to assign the inspection to."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ inspection_identity?: { inspection_id?: string } }>("/inspections/integration/v1/inspections", {
        template_id: a.template_id,
      });
      const id = res.inspection_identity?.inspection_id;
      if (!id) throw new ToolError("The API accepted the request but returned no inspection ID. Check the inspection list before retrying, to avoid a duplicate.");
      let siteSet = false;
      if (a.site_id) {
        await ctx.client.put(`/inspections/v1/inspections/${encodeURIComponent(id)}/site`, { site_id: a.site_id });
        siteSet = true;
      }
      return { summary: `Started inspection ${id}${siteSet ? ` at site ${a.site_id}` : ""}.`, data: { id, site_set: siteSet || undefined, link: links.inspection(id) } };
    },
  }),

  defineTool({
    name: "sc_update_inspection",
    title: "Update inspection",
    toolset: "inspections",
    access: "write",
    idempotent: true,
    description:
      "Patches one inspection. Pass only the fields to change: owner_id, site_id, and/or simple answers (text, number, checkbox, single datetime, or one question's selected response IDs plus an optional note). Returns which fields changed.",
    input: {
      inspection_id: P.inspectionId,
      owner_id: z.string().optional().describe("New owner user ID (user_...)."),
      site_id: z.string().optional().describe("New site ID."),
      answers: z
        .array(
          z.object({
            item_id: z.string().describe("Question item ID within the inspection."),
            type: z.enum(["text", "number", "paragraph", "checkbox", "question", "datetime"]).describe("Answer kind."),
            text: z.string().optional().describe("Value for text/paragraph answers."),
            number: z.number().optional().describe("Value for number answers."),
            checked: z.boolean().optional().describe("Value for checkbox answers."),
            datetime: z.string().datetime({ offset: true }).optional().describe("Value for datetime answers (ISO 8601)."),
            response_ids: z.array(z.string()).optional().describe("Selected response IDs for question answers."),
            note: z.string().max(5000).optional().describe("Note attached to the answer."),
          }),
        )
        .max(50)
        .optional()
        .describe("Simple answer updates (max 50 per call). Find item IDs with sc_get_inspection_answers."),
      reason,
    },
    run: async (a, ctx) => {
      const base = `/inspections/v1/inspections/${encodeURIComponent(a.inspection_id)}`;
      const changed: string[] = [];
      const failed: Array<{ field: string; error: string }> = [];
      if (a.owner_id !== undefined) {
        try {
          await ctx.client.put(`${base}/owner`, { owner_id: a.owner_id });
          changed.push("owner");
        } catch (e) {
          failed.push({ field: "owner", error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (a.site_id !== undefined) {
        try {
          await ctx.client.put(`${base}/site`, { site_id: a.site_id });
          changed.push("site");
        } catch (e) {
          failed.push({ field: "site", error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (a.answers?.length) {
        const kinds = {
          text: "ITEM_TYPE_TEXT",
          number: "ITEM_TYPE_NUMBER",
          paragraph: "ITEM_TYPE_PARAGRAPH",
          checkbox: "ITEM_TYPE_CHECKBOX",
          question: "ITEM_TYPE_QUESTION",
          datetime: "ITEM_TYPE_DATETIME",
        } as const;
        const items = a.answers.map((ans) => {
          const item: Record<string, unknown> = { item_id: ans.item_id, item_type: kinds[ans.type] };
          if (ans.note !== undefined) item.note = ans.note;
          if (ans.type === "text" || ans.type === "paragraph") item[`${ans.type}_item`] = { value: ans.text };
          else if (ans.type === "number") item.number_item = { value: ans.number };
          else if (ans.type === "checkbox") item.checkbox_item = { value: ans.checked };
          else if (ans.type === "datetime") item.datetime_item = { value: ans.datetime };
          else if (ans.type === "question") item.question_item = { response_ids: ans.response_ids ?? [] };
          return item;
        });
        try {
          await ctx.client.put(base, { items });
          changed.push(`answers(${a.answers.length})`);
        } catch (e) {
          failed.push({ field: "answers", error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!changed.length && !failed.length) throw new ToolError("Nothing to update: pass owner_id, site_id or at least one answer.");
      return {
        summary: failed.length
          ? `Updated ${changed.length} change(s); ${failed.length} failed (${failed.map((f) => f.field).join(", ")}).`
          : `Updated ${changed.join(", ")}.`,
        data: { id: a.inspection_id, changed, failed: failed.length ? failed : undefined, link: links.inspection(a.inspection_id) },
      };
    },
  }),

  defineTool({
    name: "sc_complete_inspection",
    title: "Complete inspection",
    toolset: "inspections",
    access: "write",
    description:
      "Marks an inspection complete. All required questions must already be answered. If the template has an approval page the inspection moves to awaiting approval instead of complete.",
    input: { inspection_id: P.inspectionId, reason },
    run: async ({ inspection_id }, ctx) => {
      const res = await ctx.client.post<{ inspection_identity?: { inspection_id?: string } }>(
        `/inspections/v1/inspections/${encodeURIComponent(inspection_id)}/complete`,
        {},
      );
      return {
        summary: `Inspection ${res.inspection_identity?.inspection_id ?? inspection_id} marked complete (or sent for approval if the template requires it).`,
        data: { id: res.inspection_identity?.inspection_id ?? inspection_id, link: links.inspection(inspection_id) },
      };
    },
  }),

  defineTool({
    name: "sc_clone_inspection",
    title: "Clone inspection",
    toolset: "inspections",
    access: "write",
    description:
      "Copies an inspection, including its answers, into a new incomplete inspection on the same template. Returns the new inspection's ID and link.",
    input: { inspection_id: P.inspectionId.describe("Inspection to copy."), reason },
    run: async ({ inspection_id }, ctx) => {
      const res = await ctx.client.post<{ inspection_id?: string }>(`/inspections/v1/inspections/${encodeURIComponent(inspection_id)}/clone`, {});
      if (!res.inspection_id) throw new ToolError("The API accepted the request but returned no inspection ID. Check the inspection list before retrying, to avoid a duplicate.");
      return { summary: `Cloned inspection ${inspection_id} to ${res.inspection_id}.`, data: { id: res.inspection_id, link: links.inspection(res.inspection_id) } };
    },
  }),

  defineTool({
    name: "sc_share_inspection",
    title: "Share inspection",
    toolset: "inspections",
    access: "write",
    description:
      "Shares an inspection with users or groups in the same organisation. You need edit or delete access on the inspection. Already-shared entries are left unchanged.",
    input: {
      inspection_id: P.inspectionId,
      shares: z
        .array(z.object({ id: z.string().describe("User or group ID to share with."), permission: z.enum(["view", "edit", "delete"]) }))
        .min(1)
        .max(100),
      reason,
    },
    run: async (a, ctx) => {
      await ctx.client.post(`/audits/${encodeURIComponent(ids.audit(a.inspection_id))}/share`, { shares: a.shares });
      return {
        summary: `Shared inspection ${a.inspection_id} with ${a.shares.length} user(s)/group(s).`,
        data: { id: a.inspection_id, shared: a.shares.length, link: links.inspection(a.inspection_id) },
      };
    },
  }),

  defineTool({
    name: "sc_restore_inspection",
    title: "Restore archived inspection",
    toolset: "inspections",
    access: "write",
    description: "Restores an archived inspection back to the active list.",
    input: { inspection_id: P.inspectionId, reason },
    run: async ({ inspection_id }, ctx) => {
      await ctx.client.delete(`/inspections/v1/inspections/${encodeURIComponent(inspection_id)}/archive`);
      return { summary: `Restored inspection ${inspection_id} from archive.`, data: { id: inspection_id, link: links.inspection(inspection_id) } };
    },
  }),

  defineTool({
    name: "sc_archive_inspection",
    title: "Archive inspection",
    toolset: "inspections",
    access: "destructive",
    description: "Archives one inspection so it leaves the active list. Reversible with sc_restore_inspection.",
    input: { inspection_id: P.inspectionId, reason },
    plan: async ({ inspection_id }, ctx) => {
      const { meta, template } = await fetchHeader(ctx, inspection_id);
      return {
        summary: `Would archive inspection "${meta.inspection_name}" (template "${template?.template_name}", site "${meta.site?.site_name}").`,
        data: projectHeader(meta, template, undefined),
        untrusted: true,
      };
    },
    run: async ({ inspection_id }, ctx) => {
      await ctx.client.post(`/inspections/v1/inspections/${encodeURIComponent(inspection_id)}/archive`, {});
      return { summary: `Archived inspection ${inspection_id}. Restore it with sc_restore_inspection.`, data: { id: inspection_id } };
    },
  }),

  defineTool({
    name: "sc_delete_inspection",
    title: "Delete inspection",
    toolset: "inspections",
    access: "destructive",
    description: "Permanently deletes one inspection. This cannot be undone.",
    input: { inspection_id: P.inspectionId, reason },
    plan: async ({ inspection_id }, ctx) => {
      const { meta, template } = await fetchHeader(ctx, inspection_id);
      return {
        summary: `Would PERMANENTLY delete inspection "${meta.inspection_name}" (template "${template?.template_name}", site "${meta.site?.site_name}").`,
        data: projectHeader(meta, template, undefined),
        untrusted: true,
      };
    },
    run: async ({ inspection_id }, ctx) => {
      await ctx.client.delete(`/inspections/v1/inspections/${encodeURIComponent(inspection_id)}`);
      return { summary: `Permanently deleted inspection ${inspection_id}.`, data: { id: inspection_id } };
    },
  }),
];
