# TICKET SITE-FIX-1: landing page fixes from design-judge round 1

Repo: safetyculture-mcp. Landing page: `site/index.html`, `site/assets/site.css`, `site/assets/site.js`. Spec: `DESIGN.md`, `PRODUCT.md`. Judge verdict: NO-SHIP (desktop 7.6, mobile 7.1). Measurements: `docs/waves/wave-2/site-judge-r1-results.json`.

## FILES ALLOWED
site/index.html, site/assets/site.css, site/assets/site.js, scripts/site-sweep.cjs (NEW). Nothing else.

## FIXES (all required)
1. MAJOR `.ask.is-pinned .ask-copy` inactive prompts at opacity 0.42 measure ~2.7:1 contrast. Remove the opacity; inactive `.ask-prompt` uses `color: var(--ink-2)` (7.78:1); active prompt uses ink + the hi-vis dot.
2. MAJOR pinned stage: the h2 scrolls off (-134px) while pinned; ~170px dead bands above and below content; ~400px blank after release. Pin from the `.section-head` so the h2 stays visible; content `justify-content: flex-start` with 32px top padding; stage height `min(100vh - header height, content + 64px)`; no bottom margin after release.
3. MAJOR mobile `.tablist`: 4 of 7 install tabs off-screen with no cue. Under 600px wrap the tabs (`flex-wrap: wrap`), and on selection `scrollIntoView({inline:'nearest', block:'nearest'})`.
4. MAJOR mobile `.ptable`: header 10px (minimum 11px: set at least 0.6875rem); under 600px hide the "previous period" column or stack each row as label/value; shorten Direction text "too few to compare" to "too few" on mobile only (keep full text in a `title`/visually-hidden span).
5. MAJOR 320px reflow: `.proof .ltable` overflows 36px. Wrap in the same `.table-scroll` container as panel tables, or `table-layout: fixed` and stack the verdict column under 360px. Page scrollWidth must equal clientWidth at 320.
6. MAJOR `#analytics .proof` repeats the Northpoint vs Eastgate table from ask step 3. Replace it with a different REAL output from `site/data/showcase.json` (use `shots.backlog` or `shots.schedules` summary + a compact table, or `shots.anomalies`), every number traceable to that file.
7. MINOR `.ptable td` overrides status classes: add `.ptable td.is-worse{color:var(--risk)}`, `.ptable td.is-dim{color:var(--panel-dim)}`, `.ptable td.is-warn{color:var(--warn)}` (define tokens if missing per DESIGN.md).
8. MINOR `#code-claude-code` overflows at 1440 (1149 vs 1130). Let code blocks wrap at sensible points (`white-space: pre-wrap; word-break: normal`) or move Copy to a header row above the code.
9. MINOR tap targets < 44px on mobile: `.btn-ghost.copy-btn` (36px tall), `.nav-menu summary` (40px), hero `.link-arrow` (22px), footer links (40px). Make them >= 44px tall.
10. MINOR every `.section-head` uses the same h2-left / paragraph-right split. Vary at least two sections (e.g. full-width heading over the tools board; stacked heading + copy in Safety).
11. MINOR hero panel 744px tall (bottom at 895px at 1440x900; caption below fold). Get the panel to about 640px: tighten metric row padding and show 2 attention rows (keep the third available in the "What you can ask" pulse step).
12. MINOR nav order must match page order; hero "Read the install guide" link points to `#install`.

## ROUTE IMPACT TABLE (fill in RESULT.md)
For each fix: selector(s) changed -> sections affected -> how verified. A fix that changes another section's measurements fails this ticket.

## SWEEP SCRIPT (acceptance)
Write `scripts/site-sweep.cjs`: launches Chromium via playwright-core (`require(process.env.PLAYWRIGHT_CORE || 'playwright-core')`, executable from `process.env.GATE_BROWSER` or `CHROME`), loads `site/index.html` from disk, and ASSERTS (exit 1 on any failure, print a table):
- at 1440x900, 1024x768, 390x844 and 320x640: `document.documentElement.scrollWidth <= clientWidth`
- H1 line count <= 3 at 1440 and 390 (height / line-height)
- every visible text node's contrast >= 4.5:1 (>= 3:1 if >= 24px or >= 18.66px bold) against its computed background (walk up for background colour)
- no element with computed font-size < 11px that contains visible text
- at 390: every `a, button, summary, [role=tab]` visible has height >= 44 (or is inline text inside a paragraph)
- at 390: all 7 `[role=tab]` are within the viewport horizontally (after wrapping)
- `.ptable td.is-worse` computed colour equals the --risk token
- hero panel height <= 680 at 1440x900
- with reducedMotion 'reduce': no element with opacity 0 that contains text
- no console errors
Run it (Linux: `GATE_BROWSER=/home/zerubroberts/.cache/ms-playwright/chromium-1194/chrome-linux/chrome PLAYWRIGHT_CORE=<path> node scripts/site-sweep.cjs`; find a playwright-core under ~/ or /usr/lib/node_modules, e.g. `find / -path '*node_modules/playwright-core/package.json' 2>/dev/null | head -1`). The sweep must pass before you commit.

## REFERENCE BAR
Linear.app home: calm, aligned, legible at every width.

## RULES
No gradients, no glass, no side-stripe borders, no em dashes, no invented numbers. Keep content visible without JS. One commit, RESULT.md (not committed) with the route impact table and sweep output. If blocked write BLOCKED.md and stop.

## ENVIRONMENT
Ubuntu Linux (WSL2), bash, Node 22. node_modules installed; do NOT run npm install. Playwright Chromium at $GATE_BROWSER.
