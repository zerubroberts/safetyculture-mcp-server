import { z } from "zod";
import type { FeedName } from "../cache/contract.js";
import { P } from "../core/params.js";
import { defineTool, type AnyToolSpec } from "../core/registry.js";
import { asTool } from "../analytics/common.js";
import { analyzeActionBacklog } from "../analytics/backlog.js";
import { analyzeCompare } from "../analytics/compare.js";
import { analyzeCredentialRadar } from "../analytics/credentials.js";
import { analyzeFailedItems } from "../analytics/failed-items.js";
import { analyzeSiteLeague, LEAGUE_METRICS } from "../analytics/league.js";
import { safetyPulse } from "../analytics/pulse.js";
import { analyzeScheduleCompliance } from "../analytics/schedule-compliance.js";

/**
 * Core analytics. Each tool syncs the feeds it needs into the local cache, computes from cached rows only
 * (pure functions in src/analytics/*.ts) and returns summary + AnalyticResult (coverage, method, caveats).
 */

const FEEDS = {
  pulse: ["inspections", "inspection_items", "actions", "issues", "templates", "sites", "schedules", "schedule_occurrences"],
  failed: ["inspections", "inspection_items", "templates", "sites", "users"],
  backlog: ["actions", "action_assignees", "sites", "users"],
  schedule: ["schedule_occurrences", "schedules", "schedule_assignees", "inspections", "sites", "templates", "users"],
  credentials: ["credentials", "users"],
  league: ["inspections", "inspection_items", "actions", "sites"],
  compare: ["inspections", "inspection_items", "actions", "sites"],
} satisfies Record<string, FeedName[]>;

const priority = z.enum(["high", "medium", "low", "none"]);

export const analyticsTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_safety_pulse",
    title: "Safety pulse (this period vs last)",
    toolset: "analytics",
    access: "read",
    core: true,
    description:
      "Weekly-style safety pulse: inspections completed, average score, failed-item rate, new issues, actions created vs completed, open overdue actions and missed scheduled inspections, each against the previous equal period, plus the top three items needing attention with links.",
    input: { period: P.period("last 7 days"), site_ids: P.siteIds },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.pulse);
      const { summary, result } = safetyPulse(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_failed_items",
    title: "Failed items Pareto",
    toolset: "analytics",
    access: "read",
    core: true,
    description:
      "Ranks failed inspection items (Pareto) by question, template, site or inspector, optionally matching text in the question or answer (use | for alternatives, e.g. \"leak|spill\"). Returns failed count, share, cumulative share, failure rate and example inspections.",
    input: {
      query: z.string().max(500).optional().describe('Text to find in the item label or response, case-insensitive; "|" separates alternatives.'),
      template_ids: P.templateIds,
      site_ids: P.siteIds,
      period: P.period("last 90 days"),
      group_by: z.enum(["item", "template", "site", "inspector"]).optional().describe("How to group failures. Default: item (question label within a template)."),
      top: z.number().int().min(1).max(200).optional().describe("Number of groups to return (default 20)."),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.failed);
      const { summary, result } = analyzeFailedItems(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_action_backlog",
    title: "Action backlog ageing",
    toolset: "analytics",
    access: "read",
    core: true,
    description:
      "Open corrective actions by age and days overdue (0-7 / 8-30 / 31-90 / 90+), open with no due date, median and p90 resolution time, opened vs closed per week and the 10 oldest open actions, grouped by site, assignee, priority or label.",
    input: {
      site_ids: P.siteIds,
      priority: z.array(priority).optional().describe("Only these priorities."),
      group_by: z.enum(["site", "assignee", "priority", "label"]).optional().describe("Grouping for the table. Default: site."),
      overdue_only: z.boolean().optional().describe("Only count open actions that are past due."),
      period: P.period("last 90 days"),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.backlog);
      const { summary, result } = analyzeActionBacklog(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_schedule_compliance",
    title: "Scheduled inspection compliance",
    toolset: "analytics",
    access: "read",
    core: true,
    description:
      "Scheduled inspections due in a period: completed on time, late, missed and still pending, with compliance % (on time / resolved), grouped by schedule, site, assignee or template, and the 10 worst groups.",
    input: {
      period: P.period("last 30 days"),
      site_ids: P.siteIds,
      template_ids: P.templateIds,
      group_by: z.enum(["schedule", "site", "assignee", "template"]).optional().describe("Grouping for the table. Default: schedule."),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.schedule);
      const { summary, result } = analyzeScheduleCompliance(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_credential_radar",
    title: "Credential expiry radar",
    toolset: "analytics",
    access: "read",
    core: true,
    description:
      "Licences and credentials that are expired or expire within 7, 30 or 90 days (up to the horizon), grouped by person and by credential type. Use before shutdowns, audits or contractor onboarding.",
    input: {
      horizon: z.string().optional().describe('How far ahead to look, e.g. "next 30 days", "next 90 days" or "2026-10-01..2026-12-31". Default: next 30 days.'),
      credential_types: z.array(z.string()).optional().describe("Only credential types whose name contains one of these (case-insensitive) or with these type IDs."),
      include_expired: z.boolean().optional().describe("Include already-expired credentials (default true)."),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.credentials);
      const { summary, result } = analyzeCredentialRadar(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_site_league",
    title: "Site league table",
    toolset: "analytics",
    access: "read",
    description:
      "Ranks sites on inspections, average score, failed-item rate, open overdue actions and median action resolution days using an equal-weight z-score composite, with rank change vs the previous period. Sites below the minimum inspection count are listed separately.",
    input: {
      period: P.period("last 90 days"),
      site_ids: P.siteIds,
      min_inspections: z.number().int().min(1).max(10_000).optional().describe("Minimum completed inspections for a site to be ranked (default 10)."),
      metrics: z.array(z.enum(LEAGUE_METRICS)).optional().describe("Metrics in the composite (default: all five)."),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.league);
      const { summary, result } = analyzeSiteLeague(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),

  defineTool({
    name: "sc_analyze_compare",
    title: "Compare periods or sites (significance-tested)",
    toolset: "analytics",
    access: "read",
    description:
      'Compares two periods, or two groups of sites, on failed-item rate (two-proportion test), average inspection score and action resolution time (Mann-Whitney), with a verdict per measure ("real difference", "probably noise", "not enough data"), effect sizes and a plain-English explanation.',
    input: {
      mode: z.enum(["periods", "sites"]).optional().describe("periods: period_a vs period_b. sites: site_ids_a vs site_ids_b over period_a. Default: sites when site groups are given."),
      period_a: P.period("last 30 days (periods) / last 90 days (sites)"),
      period_b: z.string().optional().describe("Second period for mode=periods. Default: the equal-length period before period_a."),
      site_ids: z.array(z.string()).optional().describe("mode=periods: restrict both periods to these sites."),
      site_ids_a: z.array(z.string()).optional().describe("mode=sites: first site group."),
      site_ids_b: z.array(z.string()).optional().describe("mode=sites: second site group."),
    },
    run: async (a, ctx) => {
      const cache = await ctx.cache.ensure(FEEDS.compare);
      const { summary, result } = analyzeCompare(cache, a, ctx.now());
      return asTool(summary, result);
    },
  }),
];
