# TICKET W7: Demo organisation (`SC_DEMO=true`)

Repo: safetyculture-mcp (open-source MCP server for Mitti, formerly SafetyCulture). Read `AGENTS.md`, `docs/SPEC.md`, `docs/CONTRIBUTING-TOOLS.md`, `src/core/client.ts`, `src/server.ts`, `test/helpers/mock-api.ts`, `docs/api-shapes.md` first.

## SETUP
You are in a git worktree without node_modules: `npm ci --no-audit --no-fund`, then `cp -r /c/src/safetyculture-mcp/.cache ./.cache` (API reference cache for `node scripts/api-ref.mjs <slug>`).

## WHY
1. Anyone can try the server with zero setup: `npx safetyculture-mcp --demo` (no token, no account).
2. Every README screenshot, GIF and marketing image is generated from this demo org, so no real customer data can ever appear in marketing.

## FILES ALLOWED
src/demo/** (new), test/demo/** (new). You may make these two SMALL edits outside src/demo, nothing else:
- `src/core/config.ts`: when `SC_DEMO` is truthy, do not require a token (use a fixed placeholder) and set `baseUrl` to `https://demo.safetyculture-mcp.invalid`.
- `src/server.ts` `buildServer`: when `config.demo` (add `demo: boolean` to Config) and no `opts.fetch` was passed, use the demo fetch from `src/demo/fetch.ts`. Also `src/index.ts`: map the `--demo` flag to `SC_DEMO=true`.

## GOAL
1. `src/demo/generate.ts`: a deterministic (seeded PRNG, fixed "now" anchored to the real current date at startup, rounded to the day) synthetic organisation for a fictional company **"Northwind Facilities"** (clearly fictional, generic names only; no real companies, people or places beyond generic city names). Scale: 12 sites in 3 regions (sites have a parent region), 60 users (fictional names from a fixed list), 8 groups, 10 templates (Daily Pre-Start, Site Safety Walk, Fire Equipment Check, Forklift Pre-Use, Hazard Report, Toolbox Talk Record, Vehicle Inspection, Warehouse Audit, First Aid Kit Check, Contractor Induction) each with 12-30 questions (question/list items with Safe/At Risk/N/A responses, plus text/datetime/signature/section items), ~1,800 inspections over the last 12 months with realistic patterns: weekday-heavy, two sites clearly worse (higher failed rates), one site improving over time, a seasonal bump, some fast "pencil-whipped" inspections by one inspector, some archived; inspection items with failures concentrated in a few items (Pareto-like: fire extinguisher tags, blocked exits, PPE, housekeeping, forklift horn); ~450 actions linked to failed items (statuses mix, some overdue, MTTR differing by site); ~120 issues across 8 categories; schedules + occurrences (some missed/late); 150 credentials (licences, tickets) with some expired and expiring in the next 30 days; 6 contractor companies; assets (40, 6 types); training courses (6) with progress; Heads Ups (5); action timeline items consistent with action status histories.
2. `src/demo/fetch.ts`: a `fetch`-compatible function that serves this org for **every endpoint the read tools and feeds call** (grep `ctx.client.(get|post|put|patch|delete)` and the paths in `src/cache/feeds.ts` across `src/toolsets/*.ts` to build the route list), with correct pagination shapes (feeds: `metadata.next_page`; list endpoints: `next_page_token`), filters the tools rely on (period, site, template, status), and IDs in the real formats (audit_<32 hex>, template_<32 hex>, user_<32 hex>, UUIDs). WhoAmI returns a fictional demo user. Write endpoints mutate an in-memory copy (so a demo user can try creating an action) and reset on restart. Unknown routes return 404 with a clear message so gaps are visible.
3. A test (`test/demo/coverage.test.ts`) that starts the server in demo mode, lists ALL tools in full mode, and calls every read tool that needs no arguments plus each list->get pair (same approach as `test/live/list-get.test.ts`), asserting no errors. Plus tests that the generator is deterministic for a fixed date and that analytic headline numbers are stable (snapshot a handful: total inspections last 30 days, failed-item rate, overdue actions).
4. The demo must make the analytics interesting: the safety pulse should show real deltas, the failed-items Pareto a clear top 5, the league table a clear best/worst, credential radar several expiring, anomalies a few flagged inspections.

## RULES
No real data. Every name is fictional and generic. Keep it under ~1,500 lines total; data tables can be compact arrays. No new dependencies.

## DONE
`npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes, `SC_DEMO=true npx tsx src/index.ts doctor` reports success. Commit on your worktree branch. Reply with: files, endpoint coverage list, any tool that could not be served and why, and the headline demo numbers.
