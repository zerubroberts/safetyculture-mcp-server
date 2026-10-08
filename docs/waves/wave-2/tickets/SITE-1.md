# TICKET SITE-1: Landing page (first cut)

Repo: safetyculture-mcp, an open-source MCP server for Mitti (formerly SafetyCulture). Build the product landing page as a static site in `site/` (deployable to GitHub Pages / Vercel as-is).

## READ FIRST
`PRODUCT.md` (audience, principles, anti-references), `DESIGN.md` (the binding visual system: tokens, type, components, motion), `README.md` (copy source of truth), `docs/FAQ.md`, `docs/guides/clients.md`, `site/data/showcase.json` (REAL tool outputs from the fictional demo organisation; every number on the page must come from this file or from the README, never invented), `assets/hero.svg`, `assets/screenshots/*.png`, `site/reports/*.html`.

## FILES ALLOWED
site/index.html, site/assets/** (CSS/JS/images you create or copy from /assets), site/favicon.svg. Do not edit anything else. Do not edit site/data or site/reports.

## PAGE (one page, sections in this order)
1. **Header**: wordmark "SafetyCulture MCP" (text, Archivo), links: Install, What you can ask, Safety, Tools, FAQ, GitHub. Sticky, light.
2. **Hero**: H1 "Ask your safety data anything." (max 3 lines at 390px and 1440px). Sub: one sentence from README. Primary CTA: a copy-command strip `npx -y safetyculture-mcp --demo doctor` with a Copy button (hi-vis variant button, once on the page). Secondary: "Read the install guide" link. Right side (stacks below on mobile): a live **instrument panel** rendered in HTML/CSS from `showcase.json` `shots.pulse` (tool name header, "demo organisation" chip, 4 metric rows with deltas and "worse/better" words, 3 attention rows). Inline the needed data into the page (no fetch required at runtime).
3. **What you can ask**: the 8 prompts from the README. Desktop (>=1024px): pinned ScrollTrigger section, scrolling advances through 4 featured prompts (pulse, failed items, compare, credentials) and the panel on the right swaps to that prompt's REAL output from showcase.json (summary + a small table). Mobile/reduced motion: static stacked list with the same content.
4. **Real reports**: the pulse report screenshot (desktop + mobile pair) in screenshot frames with captions; a link to open `reports/safety-pulse.html` and `reports/audit-pack.html`.
5. **Safe by default**: the six controls from README as a typeset list (not identical cards), plus the real dry-run text from `shots.dryrun.notice` + summary in a panel (redact the token value to `…`).
6. **Install**: accessible tablist (Claude Code, Codex, Claude Desktop, Cursor, VS Code, Devin/Windsurf, Docker) with the exact snippets from docs/guides/clients.md, copy buttons, link to the full guide.
7. **Tools**: "126 tools in 20 toolsets": the README toolset table rendered as a panel board (mono tool counts), link to docs/TOOLS.md on GitHub.
8. **Analytics you can trust**: short paragraph + the 13 analysis names; the compare example as the proof point.
9. **FAQ**: 8 questions as native details/summary (copy from README/FAQ.md).
10. **Footer**: MIT, GitHub link, trademark notice exactly: "Independent open-source project. Not affiliated with, endorsed by or supported by SafetyCulture Pty Ltd or Mitti."

## TECH
Single `index.html` + `assets/site.css` + `assets/site.js`. Fonts: Google Fonts Archivo (variable, wdth+wght) and IBM Plex Mono. GSAP 3 + ScrollTrigger from cdnjs (https://cdnjs.cloudflare.com/ajax/libs/gsap/...). All content visible without JS; motion only enhances. `prefers-reduced-motion` = no movement. No frameworks, no build step. Links to repo: https://github.com/zerubroberts/safetyculture-mcp-server.

## RULES (binding, from DESIGN.md and the house design doctrine)
Light theme, true off-white page, graphite ink, hi-vis yellow-green accent used sparingly (never as text on light backgrounds), dark instrument panels for tool output. NO: gradients, gradient text, glassmorphism, side-stripe (left-border) accent cards, identical icon-card grids, eyebrow labels above every section, numbered section markers, em dashes, buzzwords, stock imagery, hard hats, Mitti/SafetyCulture logos or colours, invented numbers, fake chat transcripts. Body contrast >= 4.5:1. No horizontal scroll at 390px. H1 <= 3 lines at 390 and 1440.

## REFERENCE BAR
Linear.app home (clarity, restraint, type), Raycast (big crisp product panels), Stripe docs (install tabs). It must look like a premium developer tool site, not a template.

## ACCEPTANCE
- Open `site/index.html` from disk: renders fully, no console errors.
- Screenshot it yourself at 1440x900 and 390x844 (use `node scripts/shoot.mjs site/index.html out.png 1440 true` and `... 390 true`; Chrome is at C:/Program Files/Google/Chrome/Application/chrome.exe) and check: no overflow, H1 lines, panel legibility, tabs work by keyboard.
- Every number on the page traceable to showcase.json or README.
- Commit on your worktree branch. Reply with: files, screenshots paths, and anything you could not do.

## SETUP
You are in a git worktree without node_modules: run `npm ci --no-audit --no-fund` only if you need tsx; the page itself needs no build.
