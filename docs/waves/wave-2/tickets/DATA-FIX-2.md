# TICKET DATA-FIX-2: fail closed in reports and the remaining analytics

Repo: safetyculture-mcp. DATA-FIX (merged) added `feedProblem`, `feedUsable`, `unavailableSentence` to `src/analytics/common.ts` and made pulse, backlog, failed-items, compare, hotspots and trend return null (never 0) when a required feed is unusable. Read `test/analytics/fail-closed.test.ts` for the pattern and `docs/ANALYTICS.md` "fail closed" section.

## GOAL
1. Reports (`src/reports/build.ts`, `sections.ts`, `html.ts`, `markdown.ts`): wherever an analytic now returns null, render "unavailable" with the reason (from the analytic's caveats/summary), never the word "null" and never 0. `topFailedItems` must not coerce null to 0; `overdueActions` must check `feedUsable(cache, "actions")` before reading the feed directly. KPI tiles with a null value show "n/a" plus a short reason line.
2. Remaining analytics that read actions, action_timeline_items, inspection_items, action_assignees or inspections without the check: league, inspectors, anomalies, stalls, template-quality, and backlog's assignee grouping (action_assignees unusable -> grouping by assignee returns unavailable, not everyone as "(unassigned)"). Also apply to the inspections feed for every analytic that depends on it (unusable -> metrics null with reason).
3. Keep successfully synced empty feeds as true zeros with the empty-feed caveat.

## FILES ALLOWED
src/reports/**, src/analytics/league.ts, src/analytics/inspectors.ts, src/analytics/anomalies.ts, src/analytics/stalls.ts, src/analytics/template-quality.ts, src/analytics/backlog.ts, src/analytics/pulse.ts, src/analytics/failed-items.ts, test/analytics/**, test/reports/**.

## ACCEPTANCE
- Tests: each report rendered with actions / inspection_items / inspections unusable contains "unavailable" and no "null" and no fabricated 0 for those figures; each listed analytic returns null metrics + reason for its required feed in the five unusable states used in fail-closed.test.ts; empty-but-synced still yields 0.
- New tests fail before the change. `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes. One commit. Reply with per-goal status.

## SETUP
Git worktree: `git merge main` first, then `npm ci --no-audit --no-fund`.
