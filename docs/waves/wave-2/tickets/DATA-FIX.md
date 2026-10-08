# TICKET DATA-FIX: fail closed when a feed is unusable (data-QA BLOCKER)

Repo: safetyculture-mcp. Read AGENTS.md, docs/ANALYTICS.md, src/cache/contract.ts, src/analytics/common.ts first.

## FINDING (independent data-QA audit, 2026-10-08)
All claimed numbers were VERIFIED by independent recomputation, but one refutation: a failure renders as a number.
- Actions feed returns 500 or 403: `sc_analyze_action_backlog` reports open 0, overdue 0, every bucket 0, completed 0, opened/closed 0 ("0 open actions: 0 overdue"); `sc_safety_pulse` reports actions created 0/0, completed 0/0, open overdue 0. Truth: 52 open, 40 overdue. The caveat says "missing, not zero" while the metrics say zero.
- Inspection-items feed 403 or still downloading: failed-item rate is correctly null but counts read 0 failed, 0 answered, 0 groups.
- Issues feed empty/unusable: pulse new_issues 0/0 (low severity: caveat present).
- Correct reference behaviour already exists: a 403 on schedule_occurrences and a 500 on credentials give null metrics. Use that same path.

## GOAL
1. Add a shared helper in `src/analytics/common.ts`, e.g. `feedUsable(cache, feed): boolean`, false when the feed was never synced, is marked unavailable, failed its last refresh with no complete snapshot, or is still syncing (coverage note "still syncing"). Distinguish: a feed that synced successfully and is genuinely empty IS usable (true zero) and keeps its "empty feed" caveat.
2. In pulse, backlog and failed-items (and any other analytic that reads actions, inspection_items or issues), when a required feed is not usable: every metric derived from it is `null` (not 0), table rows derived from it are omitted, and the summary sentence says the figure is unavailable and why (e.g. "Action figures unavailable: the actions feed could not be read (HTTP 403)."). Never print "0 open actions" in that case.
3. Compare: `p_value` must never display as 0. Report it with enough precision (e.g. scientific notation to 2 significant figures, or "< 0.0001") so 6e-10 is not shown as 0.
4. Docs (docs/ANALYTICS.md): make the backlog buckets explicit and non-overlapping (0-7, 8-30, 31-90, over 90 days; day 90 is in 31-90), state that "completed" and resolution time exclude Can't do actions while "closed in period" includes them, and note that occurrences with status OVERDUE are classified as overdue.

## FILES ALLOWED
src/analytics/common.ts, src/analytics/pulse.ts, src/analytics/backlog.ts, src/analytics/failed-items.ts, src/analytics/compare.ts, src/analytics/hotspots.ts, src/analytics/trend.ts, docs/ANALYTICS.md, test/analytics/** (new tests allowed).

## ACCEPTANCE
- Regression tests with FakeCache: actions feed unavailable / failed / still syncing -> backlog and pulse action metrics are null and the summary says unavailable; inspection_items unusable -> failed/answered/groups null; issues unusable -> new_issues null; a successfully synced EMPTY feed still yields 0 with the empty-feed caveat; p_value 6e-10 is not rendered as 0.
- Each new test fails on the current code (check by stashing your source change) and passes after.
- `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes. One commit on your branch. Reply with per-goal status and test list.

## SETUP
Git worktree of C:\src\safetyculture-mcp: `git merge main` first, then `npm ci --no-audit --no-fund`.
