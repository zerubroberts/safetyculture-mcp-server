import { esc } from "../reports/html.js";
import { CLIENT_JS } from "./client.js";
import type { DashboardData } from "./data.js";
import { CSS } from "./styles.js";

/**
 * The dashboard document: one self-contained HTML file. Inline CSS, inline script, inline SVG drawn in the
 * browser, system fonts, and a Content-Security-Policy that forbids every network request, so the file works
 * from disk and cannot phone home. The data rides along as a JSON block (not executed) with every "<", ">"
 * and "&" escaped, so record text cannot close the block or inject markup.
 */

export const DASHBOARD_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";

export const VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "inspections", label: "Inspections" },
  { key: "actions", label: "Actions" },
  { key: "schedules", label: "Schedules" },
  { key: "sites", label: "Sites" },
  { key: "team", label: "People and templates" },
] as const;

/** JSON safe to place inside a <script type="application/json"> element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

/** Plain-text fallback for readers without JavaScript: the headline answer of each view, default filters. */
function noscript(data: DashboardData): string {
  const slice = data.slices[`${data.default_period}|all`];
  const league = data.league[data.default_period];
  if (!slice) return "";
  const lines = [
    ["Overview", slice.overview.answer],
    ["Inspections", slice.inspections.answer],
    ["Actions", slice.actions.answer],
    ["Schedules", slice.schedules.answer],
    ["Sites", league?.answer ?? ""],
    ["People and templates", slice.team.answer],
  ];
  const period = data.periods.find((p) => p.key === data.default_period);
  return `<noscript><div class="main" style="padding-top:24px"><h1>Safety dashboard</h1><p class="question">${esc(period?.label ?? "")}. Turn on JavaScript to use the interactive views; the headline answers are below.</p><ul>${lines
    .map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`)
    .join("")}</ul></div></noscript>`;
}

export function renderDashboardHtml(data: DashboardData | null): string {
  const nav = VIEWS.map(
    (v) =>
      `<li><a class="item" data-view="${v.key}" href="#/${v.key}"><span class="pip" aria-hidden="true"></span><span>${esc(v.label)}</span><span class="count" hidden></span></a></li>`,
  ).join("");
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${DASHBOARD_CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>Safety dashboard</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the dashboard</a>
<div class="app">
<nav class="nav" aria-label="Dashboard views">
<div class="brand"><span class="tool"><i aria-hidden="true"></i>safetyculture-mcp</span><b>Safety dashboard</b><span class="org">Organisation <code id="org"></code><br>Data as of <span id="asof"></span></span></div>
<ol>${nav}</ol>
<div class="foot"><button id="theme" type="button" aria-pressed="false"><span>Light theme</span><span class="k" aria-hidden="true">theme</span></button><button id="print" type="button"><span>Print / PDF</span><span class="k" aria-hidden="true">all views</span></button></div>
<p class="fine" id="more"></p>
</nav>
<div class="main">
<div class="bar" role="region" aria-label="Filters">
<div class="seg" id="periods" role="group" aria-label="Period"></div>
<label class="sel">Site <select id="site" aria-label="Site filter"></select></label>
<div class="chips" id="chips" aria-live="polite"></div>
</div>
<main id="main" tabindex="-1"></main>
</div>
</div>
${data ? noscript(data) : ""}
<div id="tip" class="tip" role="tooltip" aria-hidden="true"></div>
<div id="live" class="sr" aria-live="polite"></div>
<script type="application/json" id="dash-data">${data ? embedJson(data) : ""}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
