import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { defineTool } from "../core/registry.js";

/**
 * Webhooks (list, create, delete).
 * Contracts verified against the cached API reference 2026-10-08
 * (webhooksservice_listwebhooks, webhooksservice_createwebhook,
 * webhooksservice_deletewebhook, webhooksservice_getwebhook).
 *
 * The signing-key endpoints (GET/POST /webhooks/v1/token) are deliberately NOT
 * exposed as tools: the signing key must never reach model output.
 */

// Every trigger event in the documented enum (86 values, verified 2026-10-08).
const TRIGGER_EVENTS = [
  "TRIGGER_EVENT_ACTION_ASSET_UPDATED",
  "TRIGGER_EVENT_ACTION_CATEGORY_UPDATED",
  "TRIGGER_EVENT_ACTION_COLLABORATORS_ADDED",
  "TRIGGER_EVENT_ACTION_COLLABORATORS_REMOVED",
  "TRIGGER_EVENT_ACTION_COLLABORATORS_UPDATED",
  "TRIGGER_EVENT_ACTION_CREATED",
  "TRIGGER_EVENT_ACTION_DATE_DUE_UPDATED",
  "TRIGGER_EVENT_ACTION_DELETED",
  "TRIGGER_EVENT_ACTION_DESCRIPTION_UPDATED",
  "TRIGGER_EVENT_ACTION_LABELS_UPDATED",
  "TRIGGER_EVENT_ACTION_ORG_UPDATED",
  "TRIGGER_EVENT_ACTION_PRIORITY_UPDATED",
  "TRIGGER_EVENT_ACTION_SITE_UPDATED",
  "TRIGGER_EVENT_ACTION_STATUS_UPDATED",
  "TRIGGER_EVENT_ACTION_TITLE_UPDATED",
  "TRIGGER_EVENT_ACTION_UPDATED",
  "TRIGGER_EVENT_ATTENDANCE_SIGNED_OFF",
  "TRIGGER_EVENT_ATTENDANCE_SIGNED_ON",
  "TRIGGER_EVENT_INCIDENT_CATEGORY_UPDATED",
  "TRIGGER_EVENT_INCIDENT_COLLABORATORS_ADDED",
  "TRIGGER_EVENT_INCIDENT_COLLABORATORS_REMOVED",
  "TRIGGER_EVENT_INCIDENT_COLLABORATORS_UPDATED",
  "TRIGGER_EVENT_INCIDENT_CREATED",
  "TRIGGER_EVENT_INCIDENT_DATE_DUE_UPDATED",
  "TRIGGER_EVENT_INCIDENT_DELETED",
  "TRIGGER_EVENT_INCIDENT_DESCRIPTION_UPDATED",
  "TRIGGER_EVENT_INCIDENT_ORG_UPDATED",
  "TRIGGER_EVENT_INCIDENT_PRIORITY_UPDATED",
  "TRIGGER_EVENT_INCIDENT_SITE_UPDATED",
  "TRIGGER_EVENT_INCIDENT_STATUS_UPDATED",
  "TRIGGER_EVENT_INCIDENT_TITLE_UPDATED",
  "TRIGGER_EVENT_INCIDENT_UPDATED",
  "TRIGGER_EVENT_INSPECTION",
  "TRIGGER_EVENT_INSPECTION_ACCESS",
  "TRIGGER_EVENT_INSPECTION_ARCHIVED",
  "TRIGGER_EVENT_INSPECTION_ARCHIVED_STATUS",
  "TRIGGER_EVENT_INSPECTION_CLONED",
  "TRIGGER_EVENT_INSPECTION_COMPLETED",
  "TRIGGER_EVENT_INSPECTION_COMPLETED_STATUS",
  "TRIGGER_EVENT_INSPECTION_DELETED_STATUS",
  "TRIGGER_EVENT_INSPECTION_DURATION",
  "TRIGGER_EVENT_INSPECTION_HAS_STARTED",
  "TRIGGER_EVENT_INSPECTION_ITEM_ADDRESS",
  "TRIGGER_EVENT_INSPECTION_ITEM_ASSET",
  "TRIGGER_EVENT_INSPECTION_ITEM_CHECKBOX",
  "TRIGGER_EVENT_INSPECTION_ITEM_DATETIME",
  "TRIGGER_EVENT_INSPECTION_ITEM_DRAWING",
  "TRIGGER_EVENT_INSPECTION_ITEM_DYNAMIC_FIELD",
  "TRIGGER_EVENT_INSPECTION_ITEM_LIST",
  "TRIGGER_EVENT_INSPECTION_ITEM_MEDIA",
  "TRIGGER_EVENT_INSPECTION_ITEM_NOTE",
  "TRIGGER_EVENT_INSPECTION_ITEM_QUESTION",
  "TRIGGER_EVENT_INSPECTION_ITEM_SIGNATURE",
  "TRIGGER_EVENT_INSPECTION_ITEM_SITE",
  "TRIGGER_EVENT_INSPECTION_ITEM_SLIDER",
  "TRIGGER_EVENT_INSPECTION_ITEM_TEMPERATURE",
  "TRIGGER_EVENT_INSPECTION_ITEM_TEXT",
  "TRIGGER_EVENT_INSPECTION_ITEM_UPDATED",
  "TRIGGER_EVENT_INSPECTION_LOCATION",
  "TRIGGER_EVENT_INSPECTION_METADATA",
  "TRIGGER_EVENT_INSPECTION_ORGANISATION",
  "TRIGGER_EVENT_INSPECTION_OWNER",
  "TRIGGER_EVENT_INSPECTION_STARTED",
  "TRIGGER_EVENT_INSPECTION_UNARCHIVED",
  "TRIGGER_EVENT_INSPECTION_UPDATED",
  "TRIGGER_EVENT_MEDIA_UPLOADED",
  "TRIGGER_EVENT_TRAINING_COURSE_COMPLETED",
  "TRIGGER_EVENT_TRAINING_COURSE_CREATED",
  "TRIGGER_EVENT_TRAINING_COURSE_DELETED",
  "TRIGGER_EVENT_TRAINING_COURSE_ENROLLED",
  "TRIGGER_EVENT_TRAINING_COURSE_EXPIRED",
  "TRIGGER_EVENT_TRAINING_COURSE_OPENED",
  "TRIGGER_EVENT_TRAINING_COURSE_PUBLISHED",
  "TRIGGER_EVENT_TRAINING_COURSE_REPUBLISHED",
  "TRIGGER_EVENT_TRAINING_COURSE_RESET",
  "TRIGGER_EVENT_TRAINING_COURSE_UNPUBLISHED",
  "TRIGGER_EVENT_TRAINING_COURSE_UPDATED",
  "TRIGGER_EVENT_TRAINING_LESSON_COMPLETED",
  "TRIGGER_EVENT_TRAINING_LESSON_CREATED",
  "TRIGGER_EVENT_TRAINING_LESSON_DELETED",
  "TRIGGER_EVENT_TRAINING_LESSON_OPENED",
  "TRIGGER_EVENT_TRAINING_LESSON_PUBLISHED",
  "TRIGGER_EVENT_TRAINING_LESSON_UNPUBLISHED",
  "TRIGGER_EVENT_TRAINING_LESSON_UPDATED",
  "TRIGGER_EVENT_TRAINING_QUIZ_SESSION_RETRIED",
  "TRIGGER_EVENT_TRAINING_QUIZ_SESSION_STARTED",
] as const;

const triggerEvent = z.enum(TRIGGER_EVENTS);

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface RawWebhook {
  webhook_id?: string;
  trigger_events?: string[];
  url?: string;
  user_id?: string;
  organisation_id?: string;
  enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Allowlist projection: only these fields leave the tool. Anything the API
 * might add later (signing keys, secrets, tokens) is dropped by construction.
 */
function projectWebhook(w: RawWebhook) {
  return {
    id: w.webhook_id,
    url: w.url,
    trigger_events: w.trigger_events,
    enabled: w.enabled,
    created_at: w.created_at,
    updated_at: w.updated_at,
  };
}

export const webhooksTools = [
  defineTool({
    name: "sc_list_webhooks",
    title: "List webhooks",
    toolset: "webhooks",
    access: "read",
    description:
      "Lists the organisation's webhooks with destination URL, trigger events and enabled state. Never returns the webhook signing key.",
    input: {},
    run: async (_a, ctx) => {
      const res = await ctx.client.get<{ webhook?: RawWebhook[] }>("/webhooks/v1/webhooks");
      const rows = (res.webhook ?? []).map(projectWebhook);
      return {
        summary: `${rows.length} webhooks registered.`,
        data: { webhooks: rows },
      };
    },
  }),

  defineTool({
    name: "sc_create_webhook",
    title: "Create webhook",
    toolset: "webhooks",
    access: "write",
    description:
      "Registers a webhook that POSTs to an https URL when any of the given trigger events fire (e.g. TRIGGER_EVENT_INSPECTION_COMPLETED, TRIGGER_EVENT_ACTION_CREATED). Returns the new webhook's ID.",
    input: {
      url: z.string().max(2000).describe("Destination URL. Must start with https://."),
      trigger_events: z.array(triggerEvent).min(1).max(86).describe("Events that fire the webhook. Use sc_list_webhooks to see which are already covered."),
      reason,
    },
    run: async (a, ctx) => {
      if (!/^https:\/\//i.test(a.url.trim())) throw new ToolError("Webhook URL must start with https://. Plain http and other schemes are refused.");
      const res = await ctx.client.post<{ webhook?: RawWebhook }>("/webhooks/v1/webhooks", {
        url: a.url,
        trigger_events: a.trigger_events,
      });
      if (!res.webhook?.webhook_id) throw new ToolError("The API accepted the request but returned no webhook ID. List webhooks before retrying, to avoid a duplicate.");
      return {
        summary: `Created webhook ${res.webhook.webhook_id} for ${a.trigger_events.length} event(s).`,
        data: projectWebhook(res.webhook),
      };
    },
  }),

  defineTool({
    name: "sc_delete_webhook",
    title: "Delete webhook",
    toolset: "webhooks",
    access: "destructive",
    description:
      "Permanently deletes one webhook by ID, stopping all its event deliveries. This cannot be undone from the API.",
    input: {
      webhook_id: z.string().describe("Webhook ID, from sc_list_webhooks."),
      reason,
    },
    plan: async ({ webhook_id }, ctx) => {
      const res = await ctx.client
        .get<{ webhook?: RawWebhook }>(`/webhooks/v1/webhooks/${encodeURIComponent(webhook_id)}`)
        .catch(() => ({ webhook: undefined }));
      const w = res.webhook;
      return {
        summary: w
          ? `Webhook ${webhook_id} posting ${(w.trigger_events ?? []).length} event(s) to ${w.url} would be permanently deleted.`
          : `Webhook ${webhook_id} was not found (or is not visible); nothing would be deleted.`,
        data: { id: webhook_id, webhook: w ? projectWebhook(w) : undefined },
      };
    },
    run: async ({ webhook_id }, ctx) => {
      await ctx.client.delete(`/webhooks/v1/webhooks/${encodeURIComponent(webhook_id)}`);
      return { summary: `Deleted webhook ${webhook_id}.`, data: { deleted: webhook_id } };
    },
  }),
];
