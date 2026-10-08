# TICKET W6B: Extended analytics and generated reports

Repo: safetyculture-mcp (open-source MCP server for Mitti, formerly SafetyCulture). Read `AGENTS.md`, `docs/SPEC.md`, `docs/CONTRIBUTING-TOOLS.md`, `src/toolsets/actions.ts`, `src/cache/contract.ts` (FROZEN), `src/analytics/common.ts`, `src/analytics/stats.ts` (shared, read-only for you) first.

## SETUP (you run in a git worktree without node_modules)
`npm ci --no-audit --no-fund`, then `cp -r /c/src/safetyculture-mcp/.cache ./.cache`. Field names: `docs/api-shapes.md` and `node scripts/api-ref.mjs <slug>` (Data Feeds in `docs/api-index.md`). Confirm every field name you read.

## FILES ALLOWED
src/analytics/trend.ts, src/analytics/template-quality.ts, src/analytics/inspectors.ts, src/analytics/anomalies.ts, src/analytics/stalls.ts, src/analytics/hotspots.ts, src/toolsets/analytics-extra.ts (NEW, export `analyticsExtraTools`; the orchestrator wires it into index.ts), src/reports/**, src/toolsets/reports.ts (export `reportsTools`), test/analytics/extra-*.test.ts, test/reports/**. Another builder owns the core analytics files (pulse, failed-items, backlog, schedule-compliance, credentials, league, compare) and src/toolsets/analytics.ts: do not touch them.

## HOW ANALYTICS RUN
Each tool calls `const cache = await ctx.cache.ensure([...feeds])`, computes from `cache.rows(feed)`, returns `asTool(summary, buildResult({...}))`. Pure functions `(cache, args, now)` in src/analytics/*.ts tested with `test/helpers/fake-cache.ts`.

## GOAL A: tools in src/toolsets/analytics-extra.ts (all read, toolset "analytics", not core)
1. `sc_analyze_inspection_trend`: metric (inspections_completed | average_score | failed_item_rate | issues_created | actions_created | actions_completed), grain week|month, period (default last 6 months), site_ids, template_ids; series with value and n per bucket; same bucket last year when available; simple linear trend slope with direction stated only when >= 6 buckets.
2. `sc_analyze_template_quality`: template_id, period (default last 6 months). Per item: times answered, fail rate, N/A rate (response text N/A or not applicable), blank/skip rate where determinable, average free-text length for text items. Buckets with evidence: "cut candidate" (answered >= 200 times and never failed, or always N/A), "fix" (skip or N/A rate >= 50%), "keep". Also median inspection duration for the template and duplicate labels.
3. `sc_analyze_inspector_activity`: period, site_ids, template_ids. Per inspector (owner): inspections completed, median duration, failed-item detection rate vs the organisation average for the same templates, share of very fast inspections (< 25% of the template median duration). Caveat: volume depends on role; this is not a performance score.
4. `sc_analyze_inspection_anomalies`: kind too_fast | perfect_streak | duplicate_burst | score_outlier, period. too_fast = duration below 25% of template median (needs >= 10 inspections of that template); perfect_streak = 10+ consecutive 100% inspections by one inspector on a template whose organisation-wide fail rate is >= 5%; duplicate_burst = 3+ inspections of the same template by the same inspector within 5 minutes; score_outlier = robust z-score (median/MAD) beyond 3.5 within template. Output flagged inspections with reason and evidence; summary must not accuse anyone.
5. `sc_analyze_action_stalls`: action_ids or filters (site, priority, period). From action_timeline_items: time spent in each status, longest gap without activity, number of due-date changes and reassignments where the item_type/item_data shows them (inspect api-ref for the item_type values), and aggregate "where actions stall" by status.
6. `sc_analyze_issue_hotspots`: period, site_ids. Issues by category x site, with a rate per 100 completed inspections at that site when inspections exist; top hotspots; rising categories vs previous period (only with >= 10 issues).

## GOAL B: reports in src/toolsets/reports.ts (export `reportsTools`, toolset "reports", all read; they write local files)
Each builds a self-contained file in `config.exportDir/reports/` (HTML with inline CSS and inline SVG charts, no external requests, no scripts required to read; plus a Markdown twin) and returns the path and a short summary. Compose them by calling the analytics pure functions (you may import the core ones from src/analytics/*.ts once they exist; until then build against your own functions and the shared common.ts, and guard imports so a missing core file does not break your build: if a core module is not present in your worktree, implement the report sections from your own analytics and leave a clearly marked TODO).
1. `sc_report_safety_pulse`: one-page weekly pulse (KPI tiles with deltas, a small trend chart, top failed items, overdue actions table, attention list).
2. `sc_report_audit_pack`: evidence pack for a scope (sites) and period (default 12 months): inspection volume and score trend, failed-item Pareto, action backlog and closure, issues by category, schedule compliance if data exists, data coverage appendix with as_of and feed coverage.
3. `sc_report_site_scorecard`: one site: trend, top failed items, open actions, issues, inspector activity summary.
HTML design: light theme, generous whitespace, a clean sans-serif system font stack, one accent colour, tabular numbers right-aligned, charts as inline SVG with labelled axes, a header stating organisation fingerprint (not name), period, generated-at and "Data from Mitti via safetyculture-mcp". Escape every user-provided string (labels, names) in HTML. No left-border accent cards. Print-friendly (A4).

## TESTS
Hand-countable synthetic fixtures with a fixed `now`; exact assertions for each analytic; reports: file exists, contains escaped text for a label containing `<script>`, has no external URLs (`http` only allowed in record links to app.safetyculture.com), Markdown twin exists.

## REFERENCE BAR
Analytics: the depth of a senior EHS analytics consultant's Power BI deliverable. Reports: the visual quality of a Stripe or Linear monthly report email, printable.

## DONE
`npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes. Commit on your worktree branch. Reply with: files, tools, test count, field names relied on per feed, uncertain definitions.
