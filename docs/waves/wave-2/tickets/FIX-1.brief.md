# FIX-1: inspections + templates review findings
Findings: 1, 2, 6, 8, 16, 21.
FILES ALLOWED: src/toolsets/inspections.ts, src/toolsets/templates.ts, test/toolsets/inspections.test.ts, test/toolsets/templates.test.ts.
Extra for finding 1/16: validate every requested change before issuing the first API call, so a bad answer never leaves a half-updated inspection.
## How to work
You are in a git worktree of C:\src\safetyculture-mcp. First `git merge main` (main is at or after commit 1e64176), then `npm ci --no-audit --no-fund` and `cp -r /c/src/safetyculture-mcp/.cache ./.cache`. Read AGENTS.md and docs/CONTRIBUTING-TOOLS.md.
The findings come from a code review in docs/waves/wave-2/codex-review-1.md (numbered by order in that file). For EACH finding assigned to you: confirm it against the code and the API reference (`node scripts/api-ref.mjs <slug>`, docs/api-index.md). If it is real, fix it minimally and add a regression test that fails before the fix. If it is not real, say why in your reply. Do not touch files outside FILES ALLOWED. Public repo: synthetic test data only. No live API calls.
Done = `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes, one commit on your branch. Reply with: per finding (fixed / not real + reason), tests added, branch + commit.
