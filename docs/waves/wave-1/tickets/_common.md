## ENVIRONMENT
Ubuntu Linux (WSL2), bash, Node 22. Your working directory is a full git clone of the repo on a branch made for this ticket. `node_modules` is already installed: do NOT run npm install / npm ci. There may be no network: every Mitti API reference page is cached in `.cache/api-ref/` and `node scripts/api-ref.mjs <slug>` reads from that cache. `docs/api-index.md` lists all 415 endpoints with their slugs. `docs/api-shapes.md` has live response shapes (types only).

## READ FIRST (in this order)
1. `AGENTS.md` (rules), 2. `docs/CONTRIBUTING-TOOLS.md` (the tool pattern and checklist), 3. `src/toolsets/actions.ts` + `test/toolsets/actions.test.ts` (the reference implementation you must copy), 4. `src/core/params.ts`, `src/core/registry.ts` (helpers; read-only for you).

## RULES
- Edit ONLY the files listed under FILES ALLOWED. Everything else is read-only.
- Never guess endpoints, fields or enum values: confirm each one with `node scripts/api-ref.mjs <slug>` before writing the call.
- All test fixtures are synthetic ("Demo Depot", "Alex Demo", ids like `site-1`). No real data.
- Keep each tool small and boring. Compact projections, plain-English descriptions, `untrusted: true` on any user-typed text.
- When done: `npx tsc --noEmit` clean, `npx vitest run` all green (the whole suite, not only your file), `node scripts/scan-secrets.mjs` passes. Then `git add -A && git commit -m "<ticket>: <summary>"` and write `RESULT.md` in the repo root: tools built (name, access, endpoint), tests added, anything uncertain. Do not commit RESULT.md.
- If blocked (missing helper, unclear API, a shared file needs changing): write `BLOCKED.md` explaining exactly what and stop. Never work around it by editing shared files.
