# AGENTS.md: rules for every agent working in this repo

Product: open-source MCP server for Mitti (formerly SafetyCulture). Public repository: assume everything you write is published.

1. Read `docs/SPEC.md` (what to build, who owns which file) and `docs/CONTRIBUTING-TOOLS.md` (how) before writing code.
2. Stay inside your ticket's file scope. Shared files (`src/core/**`, `src/server.ts`, `src/toolsets/index.ts`, `package.json`, `tsconfig.json`) belong to the orchestrator: if you need a change there, write it in BLOCKED.md or RESULT.md instead of making it.
3. **No real data, ever.** No customer, client or organisation names, no real IDs, emails, inspection contents or API responses in code, tests, docs or commit messages. Fixtures are synthetic. `npm run lint:secrets` must pass.
4. Never guess API contracts: `node scripts/api-ref.mjs <slug>`, `docs/api-shapes.md`.
5. Definition of done: `npx tsc --noEmit` clean, `npx vitest run` green, lint:secrets passes, RESULT.md written (what you built, tool list, tests added, open questions). If blocked, write BLOCKED.md and stop; never work around a blocker.
6. No new runtime dependencies. Dev dependencies only with a reason in RESULT.md.
7. No `npm install` / `npm ci` inside a ticket (node_modules is prepared for you).
