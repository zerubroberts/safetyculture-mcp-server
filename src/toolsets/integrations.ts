import { join } from "node:path";
import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { defineTool, type AnyToolSpec } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";
import { BUNDLE_FEEDS, writeBiBundle } from "../exports/bi-bundle.js";
import { safeStem, timestampSlug } from "../exports/dataset.js";
import { redactSecrets } from "../security/redact.js";

/**
 * Integrations: BI bundle export (local files) and chat notifications.
 *
 * Chat webhooks are configured only by the operator, never by the model:
 *   SC_NOTIFY_WEBHOOKS='{"safety-team":"https://hooks.slack.com/services/...",
 *                        "ops":{"url":"https://<tenant>.logic.azure.com/...","type":"teams"}}'
 * The tool takes a webhook NAME. Type is inferred from the host (hooks.slack.com = Slack,
 * Microsoft hosts = Teams) or set explicitly with {"url","type"}.
 *
 * Teams payload: the Adaptive Card message envelope ({type:"message", attachments:[AdaptiveCard]}).
 * It is the format of the Teams "Workflows" webhook template (Post to a channel when a webhook
 * request is received) and is also accepted by legacy Office 365 incoming webhooks.
 */

export const MESSAGE_MAX = 3000;

type ChatKind = "slack" | "teams";
interface Webhook {
  name: string;
  url: URL;
  kind: ChatKind;
}

const TEAMS_HOSTS = /(^|\.)(webhook\.office\.com|office\.com|logic\.azure\.com|powerautomate\.com|powerplatform\.com|api\.powerplatform\.com)$/i;

export function loadWebhooks(env: NodeJS.ProcessEnv = process.env): Map<string, Webhook> {
  const raw = env.SC_NOTIFY_WEBHOOKS;
  const out = new Map<string, Webhook>();
  if (!raw?.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ToolError("SC_NOTIFY_WEBHOOKS is not valid JSON. Expected an object of name -> https URL.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ToolError("SC_NOTIFY_WEBHOOKS must be a JSON object of name -> https URL.");
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = typeof value === "string" ? { url: value } : (value as { url?: unknown; type?: unknown });
    if (!spec || typeof spec.url !== "string") continue;
    let url: URL;
    try {
      url = new URL(spec.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const kind: ChatKind | undefined =
      spec.type === "slack" || spec.type === "teams"
        ? spec.type
        : /(^|\.)hooks\.slack\.com$/i.test(url.hostname)
          ? "slack"
          : TEAMS_HOSTS.test(url.hostname)
            ? "teams"
            : undefined;
    if (!kind) continue;
    out.set(name, { name, url, kind });
  }
  return out;
}

/** Slack mrkdwn differs from Markdown: **bold** -> *bold*, [text](url) -> <url|text>. */
export function toSlackMrkdwn(md: string): string {
  return md.replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<$2|$1>");
}

export function chatPayload(kind: ChatKind, message: string): unknown {
  if (kind === "slack") return { text: toSlackMrkdwn(message) };
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [{ type: "TextBlock", text: message, wrap: true }],
        },
      },
    ],
  };
}

export const integrationsTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_export_bi_bundle",
    title: "Export a BI bundle (Power BI / Qlik / Excel)",
    toolset: "integrations",
    access: "read",
    description:
      "Writes a folder with a star schema as CSV (inspections, inspection items, actions, issues, schedule occurrences, sites, templates, users, dates), a manifest, a Power Query M script, a Qlik load script and a README. Uses the local cache (synced first if older than an hour); only local files are written.",
    input: {
      period: z.string().optional().describe('Only facts dated in this window, e.g. "last 12 months", "2026". Dimensions are always complete. Default: everything cached.'),
      folder_name: z.string().max(80).optional().describe("Folder name inside the export folder (default: bi-bundle-<timestamp>)."),
    },
    run: async ({ period, folder_name }, ctx) => {
      const cache = await ctx.cache.ensure(BUNDLE_FEEDS);
      const now = ctx.now();
      const p = period ? parsePeriod(period, now) : undefined;
      const dir = join(ctx.config.exportDir, folder_name ? safeStem(folder_name) : `bi-bundle-${timestampSlug(now)}`);
      const res = writeBiBundle(cache, { dir, pii: ctx.config.pii, now, period: p });
      const partial = res.manifest.coverage.filter((c) => !c.complete).map((c) => c.feed);
      const counts = Object.fromEntries(res.manifest.tables.map((t) => [t.name, t.rows]));
      return {
        summary:
          `BI bundle written to ${res.dir}: ${counts.fact_inspections} inspections, ${counts.fact_inspection_items} items, ${counts.fact_actions} actions, ${counts.fact_issues} issues, ${counts.fact_schedule_occurrences} schedule occurrences.` +
          (partial.length ? ` Partial feeds (row cap or never synced): ${partial.join(", ")}.` : ""),
        data: { folder: res.dir, files: res.files, rows: counts, period: res.manifest.period, coverage: res.manifest.coverage },
      };
    },
  }),

  defineTool({
    name: "sc_post_to_chat",
    title: "Post to Slack or Teams",
    toolset: "integrations",
    access: "write",
    description:
      "Posts a short Markdown message to a Slack or Microsoft Teams channel through an incoming webhook that the server operator configured by name (SC_NOTIFY_WEBHOOKS). Call without a valid name to see the configured names.",
    input: {
      webhook: z.string().min(1).max(100).describe("Name of a configured webhook (from SC_NOTIFY_WEBHOOKS), not a URL."),
      message: z.string().min(1).max(MESSAGE_MAX).describe(`Markdown message, max ${MESSAGE_MAX} characters.`),
      reason: z.string().max(500).optional().describe("Why this message is being sent. Stored in the local audit log."),
    },
    run: async ({ webhook, message }) => {
      const hooks = loadWebhooks(process.env);
      if (!hooks.size)
        throw new ToolError("No chat webhooks are configured. The server operator must set SC_NOTIFY_WEBHOOKS to a JSON object of name -> https webhook URL.");
      const hook = hooks.get(webhook);
      if (!hook) throw new ToolError(`No webhook named "${webhook}". Configured: ${[...hooks.keys()].join(", ")}.`);
      const text = redactSecrets(message);
      let res: Response;
      try {
        res = await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(chatPayload(hook.kind, text)),
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new ToolError(`Could not reach the ${hook.kind} webhook "${hook.name}": ${err instanceof Error ? err.message : String(err)}. Nothing was posted.`);
      }
      if (!res.ok) {
        const body = redactSecrets((await res.text().catch(() => "")).slice(0, 200));
        throw new ToolError(`The ${hook.kind} webhook "${hook.name}" answered HTTP ${res.status}${body ? `: ${body}` : ""}. The message was probably not posted.`);
      }
      return {
        summary: `Posted ${text.length} characters to ${hook.kind === "slack" ? "Slack" : "Teams"} webhook "${hook.name}".`,
        data: { webhook: hook.name, kind: hook.kind, characters: text.length, status: res.status },
      };
    },
  }),
];
