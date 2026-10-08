# STATE (for workers and the next session)

Updated 2026-10-08 by the orchestrator (Claude Opus 5.5, PC).

## Where we are
- Wave 0 + 1 DONE and merged: 126 tools, cache + sync, 13 analytics, 3 reports, exports, demo org, MCPB extension, Docker. 388 tests.
- Wave 2 IN FLIGHT: landing page (SITE-1), data-QA independent audit, security re-verification pass 2.
- Reviews done: security verification pass 1 (6 refuted -> fixed with regression tests), Codex code review (24 findings -> fixed).
- Verified installs: Claude Code (connected), Codex (tool call), Docker (healthz/401/initialize). Claude Desktop .mcpb validated + packed.
- Live tests against the Cast org: read smoke (48 tools), list->get (13 types), write cycle (create/update/dry-run/delete, 0 leftovers).

## Linear
Project P-PRD-49. Wave 1 PRD-425 (+426..432), wave 2 PRD-433.

## Decisions (Zerub 2026-10-08)
Name stays "SafetyCulture MCP"; publish = fresh history to the same repo after Zerub's final go; live write tests allowed (tiny, cleaned up).

## Open follow-ups
- MCP protocol 2026-07-28 needs SDK v2 (@modelcontextprotocol/server); SDK 1.32 speaks 2025-11-25 (clients fall back).
- npm publish needs NPM_TOKEN secret; registry listing via mcp-publisher after publish.
- ChatGPT web needs public HTTPS + OAuth (not provided by this server's bearer mode).

## Rules
See AGENTS.md. No real data in the repo. Live tests read-only by default, counts only.
