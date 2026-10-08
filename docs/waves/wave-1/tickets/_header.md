## REFERENCE BAR
Match or beat the tool design of GitHub's official MCP server (github/github-mcp-server): small focused tools, precise descriptions, consistent parameters, compact outputs, every write clearly marked. `src/toolsets/actions.ts` is the house style.

## ACCEPTANCE
- Every tool listed in GOAL exists with the stated access level and core flag, in the file's existing array export.
- Each tool has at least one test asserting the exact request (method, path, body/query) and the projected output. Write tools are tested hidden in read-only mode. Destructive tools are tested for DRY RUN first, then execution only with the confirm token.
- tsc clean, full vitest suite green, `node scripts/scan-secrets.mjs` passes, one commit on this branch, RESULT.md written.
