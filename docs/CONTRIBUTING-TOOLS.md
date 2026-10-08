# How to add a tool

Copy the pattern in `src/toolsets/actions.ts`. Every tool is a `defineTool({...})` in its toolset file, exported in that file's array (already wired into `src/toolsets/index.ts`).

## Checklist
1. **Name** `sc_<verb>_<noun>`, snake_case. **Title** in plain English. **Description**: one or two sentences saying what it returns and when to use it. No marketing words.
2. **access**: `read` (never changes data), `write` (creates/updates), `destructive` (delete, archive, permission removal, anything bulk). Destructive tools MUST have `plan()` that fetches and describes what would change without changing it.
3. **core: true** only if it is in the core list in `docs/SPEC.md`.
4. **input**: zod raw shape. Reuse `P.*` from `src/core/params.ts` (period, limit, siteIds, templateId, pageToken...). Every field gets `.describe()`. Use enums with friendly values (`"high"`), map to API IDs inside the tool.
5. **Find the real API contract first**: `node scripts/api-ref.mjs <slug>` (slugs from https://developer.mitti.com/llms.txt). Never guess an endpoint, field name or enum value. `docs/api-shapes.md` has live response shapes. If an endpoint's behaviour is unclear, implement the documented contract and note the uncertainty in a code comment.
6. **Return** `{ summary, data, untrusted? }`:
   - `summary`: one sentence with counts the model can quote.
   - `data`: a compact projection (pick the useful fields, flatten nesting, friendly enum names, add `link` where `links.*` supports the kind). Never return the raw API payload unless the tool is a raw passthrough.
   - `untrusted: true` whenever `data` contains user-typed text (titles, notes, descriptions, comments, answers).
7. **Pagination**: list tools take `limit` and `page_token` and return `next_page_token`. Use `ctx.client.collectFeed` / `collectPages` when you must aggregate; respect `maxItems`.
8. **Writes**: accept an optional `reason` (max 500 chars). Never retry a non-idempotent POST yourself. If the API returns no ID after a create, say so and tell the user to check before retrying.
9. **IDs**: normalise with `ids.audit/template/user/uuid` from params.ts; endpoints differ on prefixed vs bare IDs, check api-ref.
10. **Errors**: throw `ToolError("plain English, what to do next")` for bad input; let `ScApiError` propagate (the registry formats it).

## Tests (required)
`test/toolsets/<toolset>.test.ts` using `test/helpers/mock-api.ts`:
- each tool: happy path asserts the exact request (method, path, body) and the projected output
- write tools are hidden in `read-only` mode; destructive tools return DRY RUN first and only execute with the confirm token
- all fixtures are synthetic (names like "Demo Depot", "Alex Demo", IDs like `site-1`). Never paste real API responses.

## Never
- Commit real data, tokens or customer names (`npm run lint:secrets` must pass).
- Add a runtime dependency without orchestrator approval.
- Edit files outside your ticket's scope (shared files: `src/core/**`, `src/server.ts`, `src/toolsets/index.ts`, `package.json` are orchestrator-owned).
