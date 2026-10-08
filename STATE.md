# STATE (for workers and the next session)

Updated 2026-10-08 by the orchestrator (Claude Opus 5.5, PC).

## Where we are
- Wave 0 DONE: secure core, actions reference toolset, test harness, stats module. main @ see `git log`.
- Wave 1 IN FLIGHT: W1-W4B (Muse, WSL clones `~/wt/scmcp-<T>`, branches `wave1/<T>`, status in `.worktrees/status/<T>/`), W5/W6/W6B (Opus executors in Claude worktrees).
- Wave 2 NEXT: demo organisation (`SC_DEMO=true`), README, docs site, screenshots from demo only, integration guides, FAQ, landing page.

## Linear
Project P-PRD-49 "SafetyCulture MCP Server (for Mitti)". Wave 1 parent PRD-425; sub-issues PRD-426..432; wave 2 PRD-433.

## Decisions pending (Zerub)
1. Product name (trademark-safe): FieldLedger / Walkdown / keep "SafetyCulture MCP" as descriptive repo name only.
2. Publish route: rewrite history of the existing public repo (old dead key in commit 07c7ddd) vs a fresh repo.

## Rules
See AGENTS.md. No real data in the repo. Live tests read-only, counts only.
