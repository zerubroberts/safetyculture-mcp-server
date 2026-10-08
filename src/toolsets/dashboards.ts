import { P } from "../core/params.js";
import { defineTool, keyFor, type AnyToolSpec } from "../core/registry.js";
import { sanitize } from "../security/redact.js";
import { buildDashboardData, DASHBOARD_FEEDS } from "../dashboard/data.js";
import { renderDashboardHtml, VIEWS } from "../dashboard/html.js";
import { writeDashboard } from "../dashboard/write.js";

// Interactive HTML dashboard (toolset "reports"): one self-contained file with six views, period presets and
// a site filter, all precomputed from the local cache by the analytics functions. Written to
// <SC_EXPORT_DIR>/dashboards/. Like the reports, it changes nothing in Mitti but writes a local file.

export const dashboardTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_build_dashboard",
    title: "Interactive safety dashboard",
    toolset: "reports",
    access: "read",
    localWrite: true,
    description:
      "Writes an interactive safety dashboard (one self-contained HTML file, opens offline in any browser) to the local export folder: overview KPIs, inspections and failed-item Pareto, action backlog ageing, schedule compliance, site comparison, and people and templates, with 7/30/90-day and 12-month presets and a site filter. Returns the file path and headline numbers.",
    input: {
      period: P.period("last 90 days"),
      site_ids: P.siteIds,
    },
    run: async (a, ctx) => {
      const now = ctx.now();
      const cache = await ctx.cache.ensure(DASHBOARD_FEEDS);
      const built = buildDashboardData(cache, { period: a.period, site_ids: a.site_ids }, now);
      // Same privacy policy as tool output and reports: contact details masked everywhere, names at strict.
      const data = sanitize(built.data, ctx.config.pii, { key: keyFor(ctx.config) });
      const path = await writeDashboard(renderDashboardHtml(data), ctx.config.exportDir, now);
      return {
        summary: `${built.summary} Saved to ${path}; open it in a browser.`,
        data: {
          html_path: path,
          period: built.metrics.period,
          organisation_fingerprint: data.fingerprint,
          views: VIEWS.map((v) => v.label),
          period_presets: data.periods.map((p) => p.long),
          site_filters: data.sites.length,
          metrics: built.metrics,
        },
        untrusted: true,
      };
    },
  }),
];
