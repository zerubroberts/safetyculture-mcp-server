import { z } from "zod";
import { P } from "../core/params.js";
import { defineTool, type AnyToolSpec } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";
import { asTool } from "../analytics/common.js";
import { TREND_METRICS, computeTrend } from "../analytics/trend.js";
import { computeTemplateQuality } from "../analytics/template-quality.js";
import { computeInspectorActivity } from "../analytics/inspectors.js";
import { ANOMALY_KINDS, computeAnomalies } from "../analytics/anomalies.js";
import { computeStalls } from "../analytics/stalls.js";
import { computeHotspots } from "../analytics/hotspots.js";

// Extended analytics (ticket W6B). Pure computation lives in src/analytics/*.ts; these wrappers
// only sync the feeds they need, parse arguments and wrap the result.

const SIX_MONTHS = "last 6 months";

export const analyticsExtraTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_analyze_inspection_trend",
    title: "Inspection trend over time",
    toolset: "analytics",
    access: "read",
    description:
      "Weekly or monthly series for one metric (inspections completed, average score, failed-item rate, issues, actions created or completed) with the count behind each value, the same bucket last year when cached, and a linear trend direction (stated only with 6+ buckets).",
    input: {
      metric: z.enum(TREND_METRICS).describe("What to chart."),
      grain: z.enum(["week", "month"]).optional().describe("Bucket size (default month)."),
      period: P.period(SIX_MONTHS),
      site_ids: P.siteIds,
      template_ids: P.templateIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const feeds = a.metric === "issues_created" ? (["issues"] as const) : a.metric.startsWith("actions") ? (["actions"] as const) : a.metric === "failed_item_rate" ? (["inspections", "inspection_items"] as const) : (["inspections"] as const);
      const cache = await ctx.cache.ensure([...feeds]);
      const { result, summary } = computeTrend(cache, { metric: a.metric, grain: a.grain ?? "month", period: parsePeriod(a.period, now, SIX_MONTHS), site_ids: a.site_ids, template_ids: a.template_ids }, now);
      return asTool(summary, result, false);
    },
  }),

  defineTool({
    name: "sc_analyze_template_quality",
    title: "Template question quality",
    toolset: "analytics",
    access: "read",
    description:
      "Per-question hygiene for one template: times answered, fail rate, N/A rate, skip rate, average free-text length, sorted into cut candidate / fix / keep with the evidence. Also the median inspection duration and duplicate labels. Use to tidy templates.",
    input: {
      template_id: z.string().describe("Template ID (template_...). Use sc_list_templates to find it."),
      period: P.period(SIX_MONTHS),
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(["inspections", "inspection_items", "templates"]);
      const { result, summary } = computeTemplateQuality(cache, { template_id: a.template_id, period: parsePeriod(a.period, now, SIX_MONTHS) }, now);
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_inspector_activity",
    title: "Inspector activity",
    toolset: "analytics",
    access: "read",
    description:
      "Per inspector (inspection owner): inspections completed, median duration, failed-item detection rate against the organisation's rate on the same templates, and the share of very fast inspections. Descriptive, not a performance score.",
    input: {
      period: P.period("last 30 days"),
      site_ids: P.siteIds,
      template_ids: P.templateIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(["inspections", "inspection_items", "users"]);
      const { result, summary } = computeInspectorActivity(cache, { period: parsePeriod(a.period, now), site_ids: a.site_ids, template_ids: a.template_ids }, now);
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_inspection_anomalies",
    title: "Inspection patterns worth a second look",
    toolset: "analytics",
    access: "read",
    description:
      "Flags inspections matching a review pattern: too fast for the template, a long perfect-score streak on a template that usually fails items, a burst of duplicates within 5 minutes, or a score far outside the template's norm. Each flag carries its reason and numbers. Prompts for review, not findings.",
    input: {
      kind: z.enum(ANOMALY_KINDS).optional().describe("Pattern to check. Default: all four."),
      period: P.period("last 30 days"),
      site_ids: P.siteIds,
      template_ids: P.templateIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const kinds = a.kind ? [a.kind] : [...ANOMALY_KINDS];
      const cache = await ctx.cache.ensure(kinds.includes("perfect_streak") ? ["inspections", "inspection_items"] : ["inspections"]);
      const { result, summary } = computeAnomalies(cache, { kinds, period: parsePeriod(a.period, now), site_ids: a.site_ids, template_ids: a.template_ids }, now);
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_action_stalls",
    title: "Where actions stall",
    toolset: "analytics",
    access: "read",
    description:
      "Replays action timelines: time spent in each status, the longest stretch without activity, due-date changes and reassignments per action, and which status holds most of the open time. Select by action IDs or by site, priority and creation period.",
    input: {
      action_ids: z.array(z.string()).optional().describe("Specific action IDs (UUIDs); combined with any other filters given."),
      site_ids: P.siteIds,
      priority: z.array(z.enum(["low", "medium", "high", "none"])).optional().describe("Only these priorities."),
      period: z.string().optional().describe('Only actions created in this window, e.g. "last 90 days", "2026-Q3". Default: all cached actions.'),
      limit: P.limit(50, 500),
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(["actions", "action_timeline_items"]);
      const { result, summary } = computeStalls(
        cache,
        { action_ids: a.action_ids, site_ids: a.site_ids, priority: a.priority, period: a.period ? parsePeriod(a.period, now) : undefined, limit: a.limit ?? 50 },
        now,
      );
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_issue_hotspots",
    title: "Issue hotspots",
    toolset: "analytics",
    access: "read",
    description:
      "Issues by category and site, with a rate per 100 completed inspections at that site, the top hotspots and the categories rising against the previous period (10+ issues).",
    input: {
      period: P.period("last 90 days"),
      site_ids: P.siteIds,
      limit: P.limit(25, 200),
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(["issues", "inspections", "sites"]);
      const { result, summary } = computeHotspots(cache, { period: parsePeriod(a.period, now, "last 90 days"), site_ids: a.site_ids, limit: a.limit ?? 25 }, now);
      return asTool(summary, result);
    },
  }),
];
