# Contributing

Thanks for helping. Three rules matter more than anything else here:

1. **No real data.** Never commit tokens, organisation names, people's names, IDs or API responses from a real account. Tests use synthetic fixtures only. `npm run lint:secrets` runs in CI and you can add a private denylist of names at `~/.safetyculture-mcp/denylist.txt`.
2. **Never guess the API.** Every endpoint, field and enum must match Mitti's published reference. `node scripts/api-ref.mjs <slug>` prints any endpoint's request and response fields (slugs are in [docs/api-index.md](docs/api-index.md)).
3. **Keep the safety model intact.** Read tools must not change data; writes are `write`; deletes, archives, permission removals and anything bulk are `destructive` with a `plan()`.

## Setup
```bash
git clone https://github.com/zerubroberts/safetyculture-mcp-server.git
cd safetyculture-mcp-server
npm ci
npm test
npx tsx src/index.ts --demo     # run against the fictional demo organisation
```

## Adding a tool
Follow [docs/CONTRIBUTING-TOOLS.md](docs/CONTRIBUTING-TOOLS.md). Copy the pattern in `src/toolsets/actions.ts`, add tests in `test/toolsets/`, then regenerate the reference with `npx tsx scripts/gen-tool-docs.ts`.

## Live tests (maintainers)
`npm run test:live` runs read-only checks against a real organisation using `SC_API_TOKEN` and prints only tool names and sizes. `SC_LIVE_WRITE_TESTS=true` adds a self-cleaning create/update/delete cycle on one `[mcp-test]` action.

## Pull requests
- `npx tsc --noEmit`, `npm test` and `npm run lint:secrets` must pass.
- Describe what changed for users in `CHANGELOG.md`.
- Plain language in tool descriptions and docs: say what the tool returns and when to use it.
