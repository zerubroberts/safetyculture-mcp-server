# FIX-2: schedules, training, sites review findings
Findings: 7, 10, 12, 13, 17, 18, 20.
FILES ALLOWED: src/toolsets/schedules.ts, src/toolsets/training.ts, src/toolsets/sites.ts, test/toolsets/schedules.test.ts, test/toolsets/training.test.ts, test/toolsets/sites.test.ts.
Note for 12: schedule IDs from the current scheduling feed look like `scheduleitem_<32 hex>` and must be sent to /scheduling/v1/schedules/{id} as a dashed UUID (already done via ids.uuid, verified live). Legacy schedule items come from /schedules/v1/schedule_items; route those to the legacy API or clearly refuse with a helpful message.
## How to work
You are in a git worktree of C:\src\safetyculture-mcp. First `git merge main` (main is at or after commit 1e64176), then `npm ci --no-audit --no-fund` and `cp -r /c/src/safetyculture-mcp/.cache ./.cache`. Read AGENTS.md and docs/CONTRIBUTING-TOOLS.md.
The findings come from a code review in docs/waves/wave-2/codex-review-1.md (numbered by order in that file). For EACH finding assigned to you: confirm it against the code and the API reference (`node scripts/api-ref.mjs <slug>`, docs/api-index.md). If it is real, fix it minimally and add a regression test that fails before the fix. If it is not real, say why in your reply. Do not touch files outside FILES ALLOWED. Public repo: synthetic test data only. No live API calls.
Done = `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes, one commit on your branch. Reply with: per finding (fixed / not real + reason), tests added, branch + commit.
