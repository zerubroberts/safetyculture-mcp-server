# STATE (for workers and the next session)

Updated 2026-10-08 by the orchestrator (Claude Opus 5.5, PC).

## Where we are
- Waves 0, 1 and 2 DONE: 126 tools, cache + sync, 13 analytics, 3 reports, exports, demo org, MCPB extension, Docker, README, landing page (design judge SHIP 8.2/8.0), docs, FAQ, guides.
- 620 unit tests (latest commit 8224015). Live Cast suite 6/6 on 2026-10-08 (read smoke, list->get, write cycle with 0 leftovers).
- Security verification: pass 1 (6 fixed), Codex review (24 fixed), pass 2 (fixed), pass 3 + 4 re-verification rounds, final CONFIRMED A-F (PRD-434; regressions in test/core/pass3.test.ts).
- Data QA: independent auditor VERIFIED all metrics on demo + live.
- Waiting on: GATE-71 (Zerub's go to force-push fresh history to the public repo).

## Linear
Project P-PRD-49. Wave 1 PRD-425 (+426..432), wave 2 PRD-433 (+434 security). Publish decision GATE-71.

## Decisions (Zerub 2026-10-08)
Name stays "SafetyCulture MCP"; publish = fresh history to the same repo after Zerub's final go; live write tests allowed (tiny, cleaned up).

## Open follow-ups
- Known, accepted: bulk_update with filters re-resolves targets at execution time (dry run shows the plan, execution re-queries); no concurrency cap on sc_query_cache child processes; HTTP mode shares one export folder across callers.
- MCP protocol 2026-07-28 needs SDK v2 (@modelcontextprotocol/server); SDK 1.32 speaks 2025-11-25 (clients fall back).
- npm publish needs NPM_TOKEN secret; registry listing via mcp-publisher after publish.
- ChatGPT web needs public HTTPS + OAuth (not provided by this server's bearer mode).

## Rules
See AGENTS.md. No real data in the repo. Live tests read-only by default, counts only.
