# DESIGN.md: safetyculture-mcp site and README visuals

Direction: **Field-grade.** Practical equipment, labelled clearly. A true off-white page with graphite ink, one hi-vis yellow-green accent (the fluoro of a site vest, used like a highlighter or a status light, never as text on light backgrounds), and dark "instrument panels" that display real tool output from the demo organisation. References studied: Groq (industrial-minimal light, one precision accent), Fingerprint (data-sheet clarity, monospace data, dark instrument modules), SST (code panel beside messaging), Svelte (single accent discipline), Dub (workbench calm).

## Colour (OKLCH; hex for reference)
| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(0.985 0 0)` (#fafafa) | page |
| `--surface` | `oklch(1 0 0)` | raised blocks, screenshot frames |
| `--line` | `oklch(0.9 0.006 250)` | 1px borders, dividers |
| `--ink` | `oklch(0.21 0.012 250)` (~#1b1f24) | headings, primary text, primary button fill |
| `--ink-2` | `oklch(0.43 0.01 250)` (~#575c63) | body copy, captions (>= 6.5:1 on bg) |
| `--hivis` | `oklch(0.91 0.2 122)` (~#cfee3a) | accent fills: highlighter marks behind 1-3 words, CTA fill, active tab underline, status dots on dark panels. Text on it is always `--ink`. |
| `--hivis-deep` | `oklch(0.55 0.15 128)` | accent as text/icons on light bg when needed (>= 4.5:1) |
| `--panel` | `oklch(0.2 0.012 250)` (~#16191d) | instrument panels (terminal, tool output) |
| `--panel-2` | `oklch(0.25 0.012 250)` | panel rows / insets |
| `--panel-ink` | `oklch(0.94 0.005 250)` | text on panels |
| `--panel-dim` | `oklch(0.72 0.01 250)` | secondary text on panels (>= 4.5:1 on panel) |
| `--ok` / `--warn` / `--risk` | `oklch(0.72 0.17 150)` / `oklch(0.8 0.15 80)` / `oklch(0.68 0.19 28)` | data states inside panels and charts only, always paired with a label or icon |

Strategy: **Restrained** on the page (accent <= 10% of surface), **committed** inside panels (dark surfaces carry the product output). No gradients, no glass, no glow.

## Typography
- **Archivo** (variable, Google Fonts, `wdth` 62-125, `wght` 100-900): the only text family.
  - Display (h1, h2): `wdth` 80 (semi-condensed, signage-like), `wght` 780, letter-spacing -0.015em, `text-wrap: balance`. h1 `clamp(2.6rem, 5.2vw + 0.6rem, 5.25rem)`, line-height 0.98. h2 `clamp(1.9rem, 2.6vw + 0.8rem, 3rem)`, line-height 1.05.
  - h3: `wdth` 100, `wght` 650, 1.25rem.
  - Body: `wdth` 100, `wght` 400, 1.0625rem / 1.6, max 68ch, `text-wrap: pretty`.
- **IBM Plex Mono** 400/500: code, tool names (`sc_safety_pulse`), commands, panel data, small labels. Never body prose.
- Scale ratio >= 1.25 between steps. No all-caps sentences; uppercase only for <= 3-word mono labels inside panels.

## Layout
- Content width 1180px max, 24px gutters (16px under 480px). Sections separated by space (96-140px desktop, 64-88px mobile) and occasional full-width 1px rules, not boxes.
- Asymmetric hero: copy left (7 cols), live instrument panel right (5 cols); stacks on mobile with panel below the CTAs.
- No identical icon-card grids. Lists of prompts and toolsets are typeset lists / tables ("panel board") with mono tool names.
- Radius: 10px panels and frames, 8px buttons, 999px only for tiny status chips. Shadows: one soft level for screenshot frames only (`0 1px 0 var(--line), 0 18px 40px -24px oklch(0.2 0.01 250 / 0.25)`).

## Components
- **Buttons**: primary = `--ink` fill, `--bg` text; hi-vis variant = `--hivis` fill, `--ink` text (used once, for the main install CTA). Secondary = transparent with 1px `--ink` border. 44px min height. Focus: 2px `--ink` outline offset 3px plus `--hivis` 4px halo.
- **Copy command**: mono command in a `--panel` strip with a "Copy" button (verb label), announces "Copied" via aria-live.
- **Tabs** (install per client): real `role=tablist` with arrow-key navigation; active tab marked by a 3px `--hivis` underline + weight, not colour alone.
- **Instrument panel**: `--panel` surface, 1px `oklch(1 0 0 / 0.08)` inner border, mono header row (tool name + "demo org" chip + as-of time), body rows with labels left and numbers right-aligned tabular.
- **Highlighter mark**: `--hivis` background on 1-3 words of a heading, padding 0 .12em, `box-decoration-break: clone`. Max once per screen.
- **Screenshot frame**: `--surface`, 1px `--line`, radius 10px, caption below in `--ink-2` stating what it is and that it is the demo organisation.
- **FAQ**: native `<details>`/`<summary>`, plus/minus mark, full-width rows separated by rules.

## Motion (GSAP + ScrollTrigger)
- Hero: headline lines rise 16px + fade (stagger 60ms, expo.out 0.9s); panel rows type in sequentially as if streaming (each row fades in 40ms apart), numbers count up once.
- "What you can ask": pinned section on desktop (>= 1024px) where scrolling advances through 4 prompts and the panel on the right swaps to the matching real tool output; on mobile it is a plain stacked list.
- Elsewhere: small, specific reveals (screenshots clip-path inset reveal; safety steps draw a connecting line). No uniform fade-up on every section.
- `prefers-reduced-motion: reduce`: no movement, content fully visible, pinned section becomes static list. All content visible without JS.

## Imagery
Only real artefacts from the demo organisation ("Northwind Facilities", fictional): generated HTML reports, real tool results, the real dry-run plan text, terminal output of `doctor` and `tools`. Diagrams (architecture, star schema) are inline SVG in the same palette. No stock photos, no hard hats, no illustrations of people, no Mitti/SafetyCulture logos.

## Voice
Plain, specific, literal verbs. No em dashes, no buzzwords, no "supercharge". Untested clients are labelled untested. Every page carries: "Independent open-source project. Not affiliated with, endorsed by or supported by SafetyCulture Pty Ltd or Mitti."
