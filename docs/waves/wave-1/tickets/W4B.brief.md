# TICKET W4B: Contractors, credentials, documents, sensors and webhooks toolsets

Repo: safetyculture-mcp, an open-source MCP server for Mitti (formerly SafetyCulture). Spec: docs/SPEC.md.

## FILES ALLOWED
src/toolsets/contractors.ts, src/toolsets/documents.ts, src/toolsets/sensors.ts, src/toolsets/webhooks.ts, test/toolsets/contractors.test.ts, test/toolsets/documents.test.ts, test/toolsets/sensors.test.ts, test/toolsets/webhooks.test.ts

## API SECTIONS
docs/api-index.md sections: Companies, Credentials, Documents, Sensors, Webhooks. Run `node scripts/api-ref.mjs <slug>` for every endpoint you call.

## GOAL
In `src/toolsets/contractors.ts` (export `contractorsTools`):
- `sc_list_companies` (read: contractor companies with type and metrics), `sc_get_company` (read: details, users, documents summary), `sc_list_company_documents` (read, with expiry), `sc_list_credential_types` (read).
- `sc_list_credentials` (read): latest credential versions; filters user, type, `expiring_within` (parse with parsePeriod, e.g. "next 30 days"), `expired`; rows person, credential type, expiry date, days until expiry, status.

In `src/toolsets/documents.ts` (export `documentsTools`): `sc_search_documents`, `sc_list_folder_items` (read).

In `src/toolsets/sensors.ts` (export `sensorsTools`): `sc_list_sensors`, `sc_get_sensor_readings` (latest readings for one sensor) (read).

In `src/toolsets/webhooks.ts` (export `webhooksTools`):
- `sc_list_webhooks` (read). Never return the webhook signing key in any output.
- `sc_create_webhook` (write): url must be https; trigger events from the documented enum only.
- `sc_delete_webhook` (destructive).
- Do not implement tools that read or regenerate the signing key.
## REFERENCE BAR
Match or beat the tool design of GitHub's official MCP server (github/github-mcp-server): small focused tools, precise descriptions, consistent parameters, compact outputs, every write clearly marked. `src/toolsets/actions.ts` is the house style.

## ACCEPTANCE
- Every tool listed in GOAL exists with the stated access level and core flag, in the file's existing array export.
- Each tool has at least one test asserting the exact request (method, path, body/query) and the projected output. Write tools are tested hidden in read-only mode. Destructive tools are tested for DRY RUN first, then execution only with the confirm token.
- tsc clean, full vitest suite green, `node scripts/scan-secrets.mjs` passes, one commit on this branch, RESULT.md written.
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
