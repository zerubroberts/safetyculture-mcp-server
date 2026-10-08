# RESULT — TICKET FIX-4: Generated reports, brand restyle and polish

## What changed (only FILES ALLOWED + RESULT.md)

- `src/reports/html.ts` — restyled to the DESIGN.md palette: graphite ink
  `oklch(0.21 0.012 250)` for text and chart bars/lines, `--ink-2`
  `oklch(0.43 0.01 250)` for secondary text, hi-vis `oklch(0.91 0.2 122)` only as
  a small highlight (marker behind the report-title first word + eyebrow status
  dot), deep hi-vis `oklch(0.55 0.15 128)` for links and "better" deltas, risk
  red `oklch(0.58 0.19 27)` for "worse" deltas. Every indigo/purple value
  (`#4f46e5`, slate `#64748b`, `#15803d`/`#b91c1c`, pale blue grid `#f1f5f9`/
  `#cbd5e1`) removed. White page, system sans-serif stack, no web fonts, no
  external requests. Partial edge buckets render at 0.32 opacity with a `†` tick
  and a "partial week/month" footnote. Tables wrapped in `.table-wrap`
  (`overflow-x: auto`) so wide tables scroll inside their container. Print keeps
  `@page{size:A4}` with `break-inside: avoid` on sections/rows/tiles/charts/
  table-wraps and no repeated header. Mobile `@media (max-width:480px)` trims
  padding for 390px widths. Delta text keeps the words "(better)"/"(worse)".
- `src/reports/model.ts` — `ChartPoint.partial?: boolean`; `fmtInstant()`
  ("8 Oct 2026, 03:00 UTC", passthrough for unparseable input); `edgePartial()`
  + `partialNote()` shared by both renderers (weekly charts always carry the
  words "partial week").
- `src/reports/build.ts` — `generatedAt` and coverage intro use `fmtInstant`;
  `coverageSection` dedupes caveats and method bullets (order-preserving, methods
  also filtered against caveats — this removes the double-printed "Lower issue
  counts…" line); `trendChart` propagates the `partial` flag from `computeTrend`.
- `src/reports/sections.ts` — coverage "Last synced" cells use `fmtInstant`
  ("never synced" unchanged).
- `src/reports/markdown.ts` — chart twin marks partial labels with `†` and
  appends the same partial footnote when an edge bucket is partial.
- `test/reports/restyle.test.ts` — 11 tests: brand tokens present, no indigo
  hex / oklch hue 260–300, delta words present, no network requests, caveats
  unique in all three reports (shared line prints once), `fmtInstant` example
  exact, header + coverage formatted with no raw ISO, partial-bar opacity +
  footnote (+ silent when full, + safety-pulse edge case), print/mobile rules
  present.

## Verification (observed this session)

- `npx tsc --noEmit` — clean.
- `npx vitest run test/reports/` — 22/22 pass (11 existing + 11 new).
- `npx vitest run` (full) — 354 pass, 1 skip, 1 fail in
  `test/e2e/stdio.test.ts` ("serves MCP on /mcp…", `fetch failed`, proxy 502).
  Re-ran that file on the untouched base via `git stash -u`: same failure, so it
  is a pre-existing environment issue (sandbox proxy), not a regression. No
  report test touches it.
- `node scripts/scan-secrets.mjs` — passes (193 files).
- Synthetic test data only (fixtures + FakeCache).
