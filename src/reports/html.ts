import { cellText, deltaText, fmt, safeHref, type Block, type Cell, type Chart, type Column, type Report, type Tile } from "./model.js";

/**
 * Self-contained HTML: inline CSS, inline SVG, no scripts, no external requests (no fonts, images
 * or stylesheets are fetched; the only URLs are record links into the Mitti web app).
 */

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ACCENT = "#4f46e5";
const INK = "#0f172a";
const MUTED = "#64748b";
const RULE = "#e2e8f0";

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f8fafc;color:${INK};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;font-size:14px;line-height:1.55}
main{max-width:880px;margin:0 auto;padding:40px 32px 56px;background:#fff}
header{padding-bottom:20px;margin-bottom:28px;border-bottom:1px solid ${RULE}}
.eyebrow{color:${ACCENT};font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0 0 6px}
h1{font-size:26px;line-height:1.25;margin:0 0 6px;font-weight:650;letter-spacing:-.01em}
.subtitle{color:${MUTED};margin:0 0 14px}
.meta{display:flex;flex-wrap:wrap;gap:6px 20px;margin:0;padding:0;list-style:none;color:${MUTED};font-size:12.5px}
.meta b{color:${INK};font-weight:600}
section{margin:0 0 36px}
h2{font-size:17px;margin:0 0 4px;font-weight:650}
.intro{color:${MUTED};margin:0 0 14px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:8px 0 4px}
.tile{border:1px solid ${RULE};border-radius:10px;padding:14px 16px;break-inside:avoid}
.tile .label{color:${MUTED};font-size:12.5px;margin:0 0 4px}
.tile .value{font-size:24px;font-weight:650;font-variant-numeric:tabular-nums;margin:0}
.tile .delta{font-size:12px;color:${MUTED};margin:4px 0 0}
.tile .delta.better{color:#15803d}.tile .delta.worse{color:#b91c1c}
table{width:100%;border-collapse:collapse;margin:6px 0 4px;font-size:13px}
th{text-align:left;font-weight:600;color:${MUTED};font-size:12px;border-bottom:1px solid ${RULE};padding:8px 10px}
td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr{break-inside:avoid}
a{color:${ACCENT};text-decoration:none}a:hover{text-decoration:underline}
.chart{margin:8px 0 6px;break-inside:avoid}
.chart figcaption{font-size:12.5px;color:${MUTED};margin:0 0 4px}
svg{display:block;width:100%;height:auto}
ul.plain{margin:6px 0;padding-left:18px}ul.plain li{margin:3px 0}
.empty{color:${MUTED};font-style:italic;margin:6px 0}
.notes{color:${MUTED};font-size:12.5px;margin:10px 0 0;padding:0 0 0 18px}
.notes-title{font-size:12px;font-weight:600;color:${MUTED};margin:12px 0 0;text-transform:uppercase;letter-spacing:.05em}
footer{margin-top:40px;padding-top:14px;border-top:1px solid ${RULE};color:${MUTED};font-size:12px}
@page{size:A4;margin:14mm}
@media print{body{background:#fff;font-size:12px}main{max-width:none;padding:0}section{break-inside:auto}h2{break-after:avoid}a{color:${INK}}}
`;

function cellHtml(c: Cell, col?: Column): string {
  const cls = col?.align === "right" || typeof c === "number" ? ' class="num"' : "";
  if (c && typeof c === "object") {
    const href = safeHref(c.href);
    return `<td${cls}>${href ? `<a href="${esc(href)}">${esc(c.text)}</a>` : esc(c.text)}</td>`;
  }
  return `<td${cls}>${esc(cellText(c))}</td>`;
}

function tileHtml(t: Tile): string {
  const d = deltaText(t);
  const cls = t.delta && t.good ? ((t.delta > 0) === (t.good === "up") ? " better" : " worse") : "";
  return `<div class="tile"><p class="label">${esc(t.label)}</p><p class="value">${esc(fmt(t.value, t.unit ?? ""))}</p>${d ? `<p class="delta${cls}">${esc(d)}</p>` : ""}</div>`;
}

/** Rounds an axis maximum up to 1, 2, 2.5 or 5 x 10^k. */
function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function chartSvg(c: Chart): string {
  const W = 680;
  const H = 240;
  const L = 56;
  const R = c.kind === "pareto" ? 48 : 16;
  const T = 14;
  const B = 52;
  const pw = W - L - R;
  const ph = H - T - B;
  const vals = c.points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const yMax = c.yMax ?? niceMax(Math.max(0, ...vals));
  const n = Math.max(1, c.points.length);
  const step = pw / n;
  const x = (i: number) => L + step * i + step / 2;
  const y = (v: number) => T + ph - (Math.max(0, v) / yMax) * ph;
  const parts: string[] = [];
  const unit = c.unit ?? "";

  for (let k = 0; k <= 4; k++) {
    const v = (yMax * k) / 4;
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${k === 0 ? "#cbd5e1" : "#f1f5f9"}"/>`);
    parts.push(`<text x="${L - 6}" y="${yy}" dy="4" text-anchor="end" font-size="11" fill="${MUTED}">${esc(fmt(Math.round(v * 10) / 10))}${esc(unit)}</text>`);
  }
  const every = Math.ceil(n / 12);
  c.points.forEach((p, i) => {
    if (i % every === 0) parts.push(`<text x="${x(i).toFixed(1)}" y="${T + ph + 16}" text-anchor="middle" font-size="10.5" fill="${MUTED}">${esc(p.label)}</text>`);
  });

  if (c.kind === "bar" || c.kind === "pareto") {
    const bw = Math.max(2, step * 0.62);
    c.points.forEach((p, i) => {
      if (p.value === null) return;
      const top = y(p.value);
      parts.push(`<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ph - top).toFixed(1)}" rx="2" fill="${ACCENT}" opacity="${c.kind === "pareto" ? 0.85 : 1}"><title>${esc(p.label)}: ${esc(fmt(p.value, unit))}</title></rect>`);
    });
  }
  if (c.kind === "line") {
    let d = "";
    let pen = false;
    c.points.forEach((p, i) => {
      if (p.value === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `;
      pen = true;
    });
    if (d) parts.push(`<path d="${d.trim()}" fill="none" stroke="${ACCENT}" stroke-width="2"/>`);
    c.points.forEach((p, i) => {
      if (p.value !== null) parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="#fff" stroke="${ACCENT}" stroke-width="2"><title>${esc(p.label)}: ${esc(fmt(p.value, unit))}</title></circle>`);
    });
  }
  if (c.kind === "pareto" && c.cumulative?.length) {
    const yc = (v: number) => T + ph - (Math.min(100, Math.max(0, v)) / 100) * ph;
    const d = c.cumulative.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${yc(v).toFixed(1)}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${MUTED}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    for (const k of [0, 50, 100]) parts.push(`<text x="${W - R + 6}" y="${yc(k).toFixed(1)}" dy="4" font-size="11" fill="${MUTED}">${k}%</text>`);
    parts.push(`<text transform="translate(${W - 8} ${T + ph / 2}) rotate(90)" text-anchor="middle" font-size="11" fill="${MUTED}">Cumulative share</text>`);
  }
  parts.push(`<text x="${L + pw / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="${MUTED}">${esc(c.xLabel)}</text>`);
  parts.push(`<text transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11.5" fill="${MUTED}">${esc(c.yLabel)}</text>`);
  if (!vals.length) parts.push(`<text x="${L + pw / 2}" y="${T + ph / 2}" text-anchor="middle" font-size="12" fill="${MUTED}">No data in this period</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}" font-family="inherit"><title>${esc(c.title)}</title>${parts.join("")}</svg>`;
}

function blockHtml(b: Block): string {
  switch (b.kind) {
    case "kpis":
      return `<div class="tiles">${b.tiles.map(tileHtml).join("")}</div>`;
    case "chart":
      return `<figure class="chart" style="margin:8px 0 6px"><figcaption>${esc(b.chart.title)}</figcaption>${chartSvg(b.chart)}</figure>`;
    case "table":
      if (!b.rows.length) return `<p class="empty">${esc(b.empty ?? "Nothing to show.")}</p>`;
      return `<table><thead><tr>${b.columns.map((c) => `<th${c.align === "right" ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c, i) => cellHtml(c, b.columns[i])).join("")}</tr>`)
        .join("")}</tbody></table>`;
    case "text":
      return `<p>${esc(b.text)}</p>`;
    case "list":
      if (!b.items.length) return `<p class="empty">${esc(b.empty ?? "Nothing to show.")}</p>`;
      return `<ul class="plain">${b.items
        .map((i) => {
          const href = safeHref(i.href);
          return `<li>${esc(i.text)}${href ? ` <a href="${esc(href)}">Open</a>` : ""}</li>`;
        })
        .join("")}</ul>`;
    case "notes":
      if (!b.items.length) return "";
      return `${b.title ? `<p class="notes-title">${esc(b.title)}</p>` : ""}<ul class="notes">${b.items.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
  }
}

export function renderHtml(r: Report): string {
  const sections = r.sections
    .map((s) => `<section><h2>${esc(s.title)}</h2>${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ""}${s.blocks.map(blockHtml).join("")}</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(r.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<p class="eyebrow">Safety report</p>
<h1>${esc(r.title)}</h1>
${r.subtitle ? `<p class="subtitle">${esc(r.subtitle)}</p>` : ""}
<ul class="meta">
<li>Organisation <b>${esc(r.fingerprint)}</b></li>
<li>Period <b>${esc(r.periodLabel)}</b></li>
<li>Generated <b>${esc(r.generatedAt)}</b></li>
<li>Data from Mitti via safetyculture-mcp</li>
</ul>
</header>
${sections}
<footer>Computed locally from cached Mitti Data Feeds by safetyculture-mcp. Organisation shown as a fingerprint, not a name. Figures reflect the cache at generation time; see the data coverage notes.</footer>
</main>
</body>
</html>
`;
}
