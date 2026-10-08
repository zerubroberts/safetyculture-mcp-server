import { z } from "zod";
import type { FeedName } from "../cache/contract.js";
import { P } from "../core/params.js";
import { defineTool, type AnyToolSpec, type ToolResult } from "../core/registry.js";
import type { PiiLevel } from "../core/config.js";
import { pseudonym, sanitize } from "../security/redact.js";
import { buildAuditPack, buildSafetyPulse, buildSiteScorecard, type Built } from "../reports/build.js";
import { writeReport } from "../reports/write.js";

// Toolset "reports": self-contained HTML reports (inline CSS and SVG, no scripts, no external
// requests) plus a Markdown twin, written to <SC_EXPORT_DIR>/reports/. Figures come from the
// local cache via the analytics functions.

async function finish(built: Built, exportDir: string, slug: string, now: Date, pii: PiiLevel): Promise<ToolResult> {
  // Same privacy policy as tool output: contact details masked in any text, names at strict.
  const paths = await writeReport(sanitize(built.report, pii), exportDir, slug, now);
  return {
    summary: `${built.summary} Saved to ${paths.html} (Markdown twin: ${paths.markdown}).`,
    data: { html_path: paths.html, markdown_path: paths.markdown, period: built.report.periodLabel, organisation_fingerprint: built.report.fingerprint, metrics: built.metrics },
    untrusted: true,
  };
}

const REPORT_FEEDS: FeedName[] = ["inspections", "inspection_items", "actions", "issues", "schedule_occurrences", "schedules", "schedule_assignees", "sites", "templates", "users"];

export const reportsTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_report_safety_pulse",
    title: "Weekly safety pulse report",
    toolset: "reports",
    access: "read",
    description:
      "Writes a one-page safety pulse (HTML and Markdown) to the local export folder: KPI tiles with changes, a 12-week inspection chart, top failed items, overdue actions and an attention list. Returns the file paths and headline numbers.",
    input: {
      period: P.period("last 7 days"),
      site_ids: P.siteIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(REPORT_FEEDS);
      const built = buildSafetyPulse(cache, { period: a.period, site_ids: a.site_ids }, now);
      return finish(built, ctx.config.exportDir, "safety-pulse", now, ctx.config.pii);
    },
  }),

  defineTool({
    name: "sc_report_audit_pack",
    title: "Audit evidence pack",
    toolset: "reports",
    access: "read",
    description:
      "Writes an audit or regulator evidence pack (HTML and Markdown) for a set of sites and period: inspection volume and score trend, failed-item Pareto, action backlog and closure, issues by category, schedule compliance when data exists, and a data coverage appendix.",
    input: {
      period: P.period("last 12 months"),
      site_ids: P.siteIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(REPORT_FEEDS);
      const built = buildAuditPack(cache, { period: a.period, site_ids: a.site_ids }, now);
      return finish(built, ctx.config.exportDir, "audit-pack", now, ctx.config.pii);
    },
  }),

  defineTool({
    name: "sc_report_site_scorecard",
    title: "Site scorecard report",
    toolset: "reports",
    access: "read",
    description:
      "Writes a scorecard for one site (HTML and Markdown): KPI tiles, monthly trend, top failed items, open actions, issues by category and an inspector activity summary.",
    input: {
      site_id: z.string().describe("Site ID. Use sc_list_sites to find it."),
      period: P.period("last 6 months"),
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(REPORT_FEEDS);
      const person = ctx.config.pii === "strict" ? (n: string) => pseudonym(n, "person") : undefined;
      const built = buildSiteScorecard(cache, { site_id: a.site_id, period: a.period }, now, { person });
      return finish(built, ctx.config.exportDir, "site-scorecard", now, ctx.config.pii);
    },
  }),
];
