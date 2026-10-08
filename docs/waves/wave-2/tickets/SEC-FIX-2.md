# TICKET SEC-FIX-2: exports, query cache and HTTP hardening (security verification pass 2)

Repo: safetyculture-mcp. Read AGENTS.md and SECURITY.md first. The orchestrator is changing src/security/*, src/core/registry.ts, src/core/config.ts and the toolset files in parallel: do NOT edit those.

## FILES ALLOWED
src/exports/**, src/cache/query.ts, src/transports/http.ts, test/exports/**, test/cache/query.test.ts, test/e2e/** (add tests), test/transports/** (new).

## FINDINGS TO FIX (verified by an adversarial verifier)
1. HIGH. BI bundle masks only dim_users. Raw emails/phones written into fact_actions, fact_inspections, fact_inspection_items, fact_issues, dim_sites, dim_templates (titles, labels, names, responses). Fix: every string cell of every CSV and JSONL the exports write goes through the same policy as tool output: `redactSecrets` always (any PII level), then `maskText(value, pii)` for contact/strict, and name columns pseudonymised at strict (`applyPii`). Centralise it in the CSV/JSONL writer so a new column can never bypass it. Import `maskText`, `redactSecrets`, `pseudonym` from src/security/redact.js (they exist; `maskText(s, pii, key?)`).
2. LOW. `applyPii` with pii=none skips redactSecrets: a token pasted into a title is exported raw. Fix as above (redactSecrets at every level).
3. MEDIUM. sc_query_cache pragma bypass via quoted identifiers: `SELECT * FROM "pragma_database_list"`, `[pragma_table_list]`, backtick forms ran because the guard strips quoted identifiers before checking. Fix: run the forbidden-keyword checks against the RAW SQL text (lower-cased, comments removed) as well as the structure, so `pragma`, `attach`, `load_extension`, `readfile`, `writefile` anywhere (even quoted) is rejected. False positives on string literals are acceptable.
4. MEDIUM. Query memory: the child loads all rows with stmt.all() before the parent's 8 MB cap. Fix: spawn the child with `--max-old-space-size=256`, iterate rows with `stmt.iterate()` keeping a running byte budget (stop at QUERY_MAX_BYTES and the row cap), and report truncation.
5. MINOR (http.ts): require the `Bearer ` prefix; accept `http://[::1]` origins as loopback; return a generic 500 message (no err.message) to clients; length-safe comparison (hash both sides with sha256 then timingSafeEqual).

## ACCEPTANCE
- Tests: poisoned synthetic rows containing `x@evil.example`, `+61 412 345 678`, and a fake token `scapi_` + 30 chars in titles/labels/responses produce NO raw occurrence in any BI-bundle or dataset file at pii=contact and pii=strict, and no raw token at pii=none; quoted pragma forms are rejected; a query producing huge rows is stopped without the child exceeding its heap (assert it returns a ToolError, not a crash); HTTP: missing `Bearer ` prefix -> 401, `http://[::1]:x` origin allowed.
- Each new test fails before your change. `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes. One commit. Reply with per-finding status.

## SETUP
Git worktree: `git merge main` first, then `npm ci --no-audit --no-fund`.
