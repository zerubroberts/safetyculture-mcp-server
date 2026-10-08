# TICKET FIX-4: Generated reports, brand restyle and polish

Repo: safetyculture-mcp (open-source MCP server for Mitti, formerly SafetyCulture). The three report tools write self-contained HTML (+ Markdown twin) via `src/reports/*`. Read `DESIGN.md` (brand system) and `PRODUCT.md` first.

## FILES ALLOWED
src/reports/html.ts, src/reports/markdown.ts, src/reports/sections.ts, src/reports/model.ts, src/reports/build.ts, test/reports/**

## GOAL
1. Restyle the HTML to the DESIGN.md palette: graphite ink `oklch(0.21 0.012 250)` for text and chart bars, `--ink-2 oklch(0.43 0.01 250)` for secondary text, hi-vis `oklch(0.91 0.2 122)` only as a small highlight (e.g. the marker behind the report title word or a status dot), deep hi-vis `oklch(0.55 0.15 128)` for links and the "better" delta colour, risk red `oklch(0.58 0.19 27)` for "worse" deltas. Remove every indigo/purple colour. Keep a white page, system sans-serif stack (no web fonts: reports must make no network requests), tabular numbers right-aligned. Delta text must not rely on colour alone (keep the words "worse"/"better").
2. Deduplicate caveats/method bullets (the safety pulse currently prints "Lower issue counts can mean less reporting, not fewer hazards." twice).
3. Format timestamps for humans: "8 Oct 2026, 03:00 UTC" instead of raw ISO in the header and the data-coverage table.
4. In the weekly bar chart, mark partial weeks at the period edges (lighter bar + a footnote "partial week") instead of presenting them as full weeks.
5. Print: A4, no cut tables (`break-inside: avoid` on rows/sections), header repeated on print is not needed.
6. Mobile (390px wide): no horizontal page scroll; wide tables scroll inside their own container.

## REFERENCE BAR
Stripe's monthly account report email / Linear's weekly digest: calm, dense, perfectly aligned, one restrained accent.

## ACCEPTANCE
- Existing report tests stay green; add tests: no indigo hex/oklch hue 260-300 colours in output; caveats unique; timestamps formatted; partial-week footnote present when the first or last bucket is partial.
- `npx tsc --noEmit` clean, full `npx vitest run` green, `node scripts/scan-secrets.mjs` passes, one commit, RESULT.md written.

## ENVIRONMENT
Ubuntu Linux (WSL2), bash, Node 22. node_modules is installed: do NOT run npm install / npm ci. No network needed.

## RULES
Edit only FILES ALLOWED. Synthetic test data only. If blocked, write BLOCKED.md and stop.
