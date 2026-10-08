import { cellText, deltaText, edgePartial, fmt, humanDates, partialNote, safeHref, type Block, type Cell, type Column, type Report, type Tile } from "./model.js";
import { NARROW, WIDE, chartSvg as chartSvgAt, sparkSvg, visualEmpty, visualSvg } from "./svg.js";
import { BG, HIVIS, HIVIS_DEEP, INK, INK_2, LINE, PANEL, PANEL_DIM, PANEL_INK, PAPER, RISK, RISK_TEXT, RISK_TINT, esc as escRaw } from "./tokens.js";

/** Escapes text and rewrites any ISO date in it to the one human format ("1 Sep 2026"). */
const esc = (s: unknown): string => escRaw(humanDates(String(s ?? "")));

/**
 * Self-contained HTML: inline CSS, inline SVG, no scripts, no external requests (no fonts, images
 * or stylesheets are fetched; the only URLs are record links into the Mitti web app).
 *
 * Layout: a document page (A4 proportions on screen, A4 in print) with a dark cover band carrying
 * the organisation fingerprint, period and generation time, an executive summary, then numbered
 * sections of exhibits. Every exhibit has an action title (the takeaway) and is drawn twice, at the
 * desktop/print width and at phone width; CSS shows the one that fits so text never scales below
 * its design size.
 */

export { escRaw as esc };
export const chartSvg = chartSvgAt;

const MONO = `ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace`;

const CSS = `
:root{--risk:${RISK};--risk-text:${RISK_TEXT};--risk-tint:${RISK_TINT}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:${BG};color:${INK};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif;font-size:14px;line-height:1.55}
main{max-width:944px;margin:32px auto 48px;background:${PAPER};border:1px solid ${LINE};border-radius:10px;overflow:hidden;box-shadow:0 1px 0 ${LINE},0 18px 40px -24px oklch(0.2 0.01 250 / 0.25)}
.cover{background:${PANEL};color:${PANEL_INK};padding:30px 32px 26px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cover-top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin:0 0 18px}
.eyebrow{font-family:${MONO};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PANEL_DIM};margin:0}
.eyebrow .dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:${HIVIS};margin-right:8px;vertical-align:1px}
.brand{font-family:${MONO};font-size:12px;color:${PANEL_DIM};margin:0}
h1{font-size:30px;line-height:1.15;margin:0 0 6px;font-weight:720;letter-spacing:-.015em;color:${PANEL_INK}}
h1 .hl{background:${HIVIS};color:${INK};padding:0 .12em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.subtitle{color:${PANEL_DIM};margin:0 0 20px;font-size:14.5px}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 20px;margin:0;padding:16px 0 0;border-top:1px solid oklch(1 0 0 / 0.12)}
.meta div{min-width:0}
.meta dt{font-family:${MONO};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${PANEL_DIM};margin:0 0 3px}
.meta dd{margin:0;font-family:${MONO};font-size:12.5px;color:${PANEL_INK};overflow-wrap:anywhere}
.body{padding:28px 32px 40px}
.exec{display:grid;grid-template-columns:150px 1fr;gap:6px 24px;padding:0 0 26px;margin:0 0 30px;border-bottom:1px solid ${LINE};break-inside:avoid}
.exec-label{font-family:${MONO};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${INK_2};margin:4px 0 0}
.exec-body{font-size:16px;line-height:1.6;margin:0;max-width:68ch;text-wrap:pretty}
.exec-body b{font-weight:680;font-variant-numeric:tabular-nums}
section{margin:0 0 40px;break-inside:avoid}
.sec-head{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid ${INK};padding:0 0 8px;margin:0 0 14px;break-after:avoid}
.sec-num{font-family:${MONO};font-size:12px;color:${INK_2}}
h2{font-size:19px;margin:0;font-weight:700;letter-spacing:-.01em;break-after:avoid}
.intro{color:${INK_2};margin:0 0 16px;max-width:75ch}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:8px 0 18px}
.tiles.n1{grid-template-columns:minmax(0,1fr)}.tiles.n2{grid-template-columns:repeat(2,minmax(0,1fr))}.tiles.n3{grid-template-columns:repeat(3,minmax(0,1fr))}.tiles.n5{grid-template-columns:repeat(5,minmax(0,1fr))}
.tile{border:1px solid ${LINE};border-radius:10px;padding:14px 16px 12px;break-inside:avoid;background:${PAPER};display:flex;flex-direction:column;min-width:0}
.tile .label{color:${INK_2};font-size:12.5px;margin:0 0 6px;line-height:1.35}
.tile .value{font-size:28px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums;margin:0;letter-spacing:-.01em}
.tile .value .unit{font-size:16px;font-weight:600;color:${INK_2};margin-left:1px}
.tile .delta{margin:8px 0 0;font-size:12px;line-height:1.35}
.tile .vs{color:${INK_2};white-space:nowrap}
.tile .chip{display:inline-block;white-space:nowrap;padding:2px 8px;border-radius:999px;background:oklch(0.95 0.004 250);color:${INK};font-variant-numeric:tabular-nums}
.tile .chip.better{background:${HIVIS};color:${INK}}
.tile .chip.worse{background:var(--risk-tint);color:var(--risk-text)}
.tile .note{font-size:12px;color:${INK_2};margin:8px 0 0;line-height:1.4}
.spark-row{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:10px}
.spark-row svg.spark{display:block;width:auto;max-width:132px;min-width:0;height:30px;flex:1 1 0}
.spark-row span{font-size:11px;color:${INK_2};white-space:nowrap}
.exhibit{margin:10px 0 26px;break-inside:avoid}
.ex-num{font-family:${MONO};font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:${INK_2};margin:0 0 3px}
.ex-title{font-size:16.5px;line-height:1.3;font-weight:680;margin:0 0 2px;text-wrap:balance}
.ex-sub{font-size:12.5px;color:${INK_2};margin:0 0 12px}
.viz-w,.viz-n{margin:0}
.viz-n{display:none}
.ex-note,.partial-note{font-size:12px;color:${INK_2};margin:8px 0 0}
svg{display:block;width:100%;height:auto;overflow:visible}
.table-wrap{overflow-x:auto;margin:6px 0 6px;break-inside:avoid}
table{width:100%;border-collapse:collapse;margin:0;font-size:13px}
th{text-align:left;font-weight:600;color:${INK_2};font-size:12px;border-bottom:1px solid ${INK};padding:8px 10px;white-space:nowrap}
td{padding:7px 10px;border-bottom:1px solid ${LINE};vertical-align:top}
tbody tr:last-child td{border-bottom:1px solid ${INK_2}}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr{break-inside:avoid}
a{color:${HIVIS_DEEP};text-decoration:none;font-weight:500}a:hover{text-decoration:underline}
ol.attn{list-style:none;margin:4px 0 8px;padding:0;counter-reset:attn}
ol.attn li{counter-increment:attn;display:grid;grid-template-columns:34px 1fr;gap:8px;padding:10px 0;border-bottom:1px solid ${LINE}}
ol.attn li::before{content:counter(attn,decimal-leading-zero);font-family:${MONO};font-size:12px;color:${INK_2};padding-top:2px}
ul.plain{margin:6px 0;padding-left:18px}ul.plain li{margin:3px 0}
.empty{color:${INK_2};font-style:italic;margin:6px 0}
.unavail{border:1px dashed ${INK_2};border-radius:10px;padding:12px 16px;margin:8px 0 14px;background:oklch(0.975 0.002 250)}
.unavail-tag{font-family:${MONO};font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:${INK_2};margin:0 0 4px}
.unavail p:last-child{margin:0}
.brief{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:4px 0 8px;break-inside:avoid}
.brief div{padding:12px 18px 4px 0;border-top:3px solid ${INK};margin-right:18px}
.brief div:last-child{margin-right:0}
.brief dt{font-family:${MONO};font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:${INK_2};margin:0 0 6px}
.brief dd{margin:0;font-size:14.5px;line-height:1.5;text-wrap:pretty}
.brief dd b{font-weight:680;font-variant-numeric:tabular-nums}
.lead{break-inside:avoid}.lead.solo{break-after:avoid}
.notes{color:${INK_2};font-size:12.5px;margin:8px 0 0;padding:0 0 0 18px}
.notes-title{font-family:${MONO};font-size:11.5px;color:${INK_2};margin:14px 0 0;text-transform:uppercase;letter-spacing:.06em}
footer{margin:0 32px;padding:14px 0 24px;border-top:1px solid ${LINE};color:${INK_2};font-size:12px}
@page{size:A4;margin:14mm}
@media print{body{background:${PAPER};font-size:12px}main{max-width:none;margin:0;border:0;border-radius:0;box-shadow:none;overflow:visible}.cover{padding:22px 24px}.body{padding:22px 0 0}footer{margin:0}section{break-inside:auto}.exhibit,.tile,.tiles,.chart,.unavail,.exec,.brief,.lead{break-inside:avoid}.table-wrap{break-inside:auto}thead{display:table-header-group}table{font-size:11.5px}th{padding:5px 8px}td{padding:4px 8px}tbody tr:nth-child(-n+2){break-after:avoid}tr{break-inside:avoid}h2,.sec-head,.ex-title,.intro{break-after:avoid}.viz-w{display:block}.viz-n{display:none}a{color:${INK};text-decoration:none}.table-wrap{overflow:visible}}
@media (max-width:980px){main{margin:0;border:0;border-radius:0}}
@media (max-width:760px){.tiles,.tiles.n3,.tiles.n5{grid-template-columns:repeat(2,minmax(0,1fr))}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.exec{grid-template-columns:1fr}.brief{grid-template-columns:1fr}.brief div{margin-right:0;padding-bottom:12px}}
@media (max-width:640px){.viz-w{display:none}.viz-n{display:block}}
@media (max-width:480px){.cover{padding:22px 16px 20px}.body{padding:22px 16px 32px}footer{margin:0 16px}h1{font-size:24px}.tile{padding:12px}.tile .value{font-size:24px}.tiles{gap:10px}th,td{padding:6px 8px}.exec-body{font-size:15px}}
`;

function cellHtml(c: Cell, col?: Column): string {
  const cls = col?.align === "right" || typeof c === "number" ? ' class="num"' : "";
  if (c && typeof c === "object") {
    if (!("text" in c)) return `<td${cls}>${esc(c.label)}</td>`;
    const href = safeHref(c.href);
    return `<td${cls}>${href ? `<a href="${esc(href)}">${esc(c.text)}</a>` : esc(c.text)}</td>`;
  }
  return `<td${cls}>${esc(cellText(c))}</td>`;
}

function tileHtml(t: Tile): string {
  const d = deltaText(t);
  const verdict = t.delta && t.good ? ((t.delta > 0) === (t.good === "up") ? "better" : "worse") : "";
  const hasDelta = t.delta !== undefined && t.delta !== null;
  const arrow = hasDelta ? (t.delta! > 0 ? "▲ " : t.delta! < 0 ? "▼ " : "") : "";
  const value = t.value === null || t.value === undefined ? "n/a" : fmt(t.value);
  const unit = t.value === null || t.value === undefined ? "" : (t.unit ?? "");
  // Chip = arrow, signed change and the verdict word; "vs previous" sits beside it in gray, so the chip never wraps.
  const [chip, vs] = hasDelta ? (d.split(" vs previous") as [string, string?]) : [d, undefined];
  const deltaHtml = !d
    ? ""
    : hasDelta
      ? `<p class="delta"><span class="chip${verdict ? ` ${verdict}` : ""}">${esc(arrow + chip)}</span> <span class="vs">vs previous${esc(vs ?? "")}</span></p>`
      : `<p class="note">${esc(d)}</p>`;
  const spark = t.spark ? sparkSvg(t.spark, t.sparkPartial) : "";
  return `<div class="tile"><p class="label">${esc(t.label)}</p><p class="value">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ""}</p>${deltaHtml}${spark ? `<div class="spark-row">${spark}${t.sparkLabel ? `<span>${esc(t.sparkLabel)}</span>` : ""}</div>` : ""}</div>`;
}

/** Wraps numbers in <b> so the executive summary scans; text is escaped piecewise. */
function emphNumbers(s: string): string {
  return humanDates(s)
    .split(/(\d[\d,]*(?:\.\d+)?%?)/)
    .map((part, i) => (i % 2 ? `<b>${esc(part)}</b>` : esc(part)))
    .join("");
}

function exhibit(n: number, title: string, subtitle: string | undefined, wide: string, narrow: string, note: string): string {
  return `<figure class="exhibit"><figcaption><p class="ex-num">Exhibit ${n}</p><h3 class="ex-title">${esc(title)}</h3>${subtitle ? `<p class="ex-sub">${esc(subtitle)}</p>` : ""}</figcaption><div class="viz-w">${wide}</div><div class="viz-n">${narrow}</div>${note}</figure>`;
}

function blockHtml(b: Block, next: () => number): string {
  switch (b.kind) {
    case "kpis":
      return `<div class="tiles n${b.tiles.length <= 5 ? b.tiles.length : b.tiles.length === 6 ? 3 : 4}">${b.tiles.map(tileHtml).join("")}</div>`;
    case "chart": {
      const note = edgePartial(b.chart.points) ? `<p class="partial-note">${esc(partialNote(b.chart.xLabel))}</p>` : "";
      return exhibit(next(), b.chart.title, b.chart.subtitle, chartSvgAt(b.chart, WIDE), chartSvgAt(b.chart, NARROW), note);
    }
    case "bars":
    case "stacked":
    case "dumbbell":
    case "heatmap":
    case "multiples":
    case "bullets": {
      if (visualEmpty(b)) return `<p class="empty">${esc(("empty" in b && b.empty) || "Nothing to show.")}</p>`;
      const partial = (b.kind === "heatmap" || b.kind === "multiples") && b.partial?.some(Boolean) ? partialNote(b.kind === "heatmap" ? "week" : "bucket") : "";
      const notes = [b.note, partial].filter(Boolean).map((t) => `<p class="ex-note">${esc(t)}</p>`).join("");
      return exhibit(next(), b.title, b.subtitle, visualSvg(b, WIDE), visualSvg(b, NARROW), notes);
    }
    case "table":
      if (!b.rows.length) return `<p class="empty">${esc(b.empty ?? "Nothing to show.")}</p>`;
      return `<div class="table-wrap"><table><thead><tr>${b.columns.map((c) => `<th${c.align === "right" ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c, i) => cellHtml(c, b.columns[i])).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
    case "text":
      return `<p>${esc(b.text)}</p>`;
    case "unavailable":
      return `<div class="unavail"><p class="unavail-tag">Not available</p><p>${esc(b.text)}</p></div>`;
    case "list":
      if (!b.items.length) return `<p class="empty">${esc(b.empty ?? "Nothing to show.")}</p>`;
      return `<ol class="attn">${b.items
        .map((i) => {
          const href = safeHref(i.href);
          return `<li><span>${esc(i.text)}${href ? ` <a href="${esc(href)}">Open</a>` : ""}</span></li>`;
        })
        .join("")}</ol>`;
    case "notes":
      if (!b.items.length) return "";
      return `${b.title ? `<p class="notes-title">${esc(b.title)}</p>` : ""}<ul class="notes">${b.items.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
    case "brief":
      return `<dl class="brief">${b.items.map((i) => `<div><dt>${esc(i.label)}</dt><dd>${emphNumbers(i.text)}</dd></div>`).join("")}</dl>`;
  }
}

/** First word carries the hi-vis marker; the rest stays plain. */
function titleHtml(title: string): string {
  const words = title.split(" ");
  const first = words.shift() ?? "";
  const rest = words.join(" ");
  return `<span class="hl">${esc(first)}</span>${rest ? ` ${esc(rest)}` : ""}`;
}

export function renderHtml(r: Report): string {
  let n = 0;
  const next = () => ++n;
  const sections = r.sections
    .map(
      (s, i) => {
        // The heading, intro and first block travel together, so a heading is never orphaned at a page foot.
        // A table may break across pages, so it stays outside the unbreakable lead (its header row repeats).
        const html = s.blocks.map((b) => blockHtml(b, next));
        const keep = s.blocks[0] && s.blocks[0].kind !== "table" ? 1 : 0;
        return `<section><div class="lead${keep ? "" : " solo"}"><div class="sec-head"><span class="sec-num">${String(i + 1).padStart(2, "0")}</span><h2>${esc(s.title)}</h2></div>${s.intro ? `<p class="intro">${esc(s.intro)}</p>` : ""}${html.slice(0, keep).join("")}</div>${html.slice(keep).join("")}</section>`;
      },
    );
  // A report that opens with a brief (the board pack) shows it first, above the executive summary.
  const opensWithBrief = r.sections[0]?.blocks[0]?.kind === "brief";
  const summary = r.summary?.length
    ? `<section class="exec"><p class="exec-label">Executive summary</p><p class="exec-body">${r.summary.map(emphNumbers).join(" ")}</p></section>`
    : "";
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
<header class="cover">
<div class="cover-top"><p class="eyebrow"><span class="dot" aria-hidden="true"></span>${esc(r.kind ?? "Safety report")}</p><p class="brand">safetyculture-mcp</p></div>
<h1>${titleHtml(r.title)}</h1>
${r.subtitle ? `<p class="subtitle">${esc(r.subtitle)}</p>` : ""}
<dl class="meta">
<div><dt>Organisation</dt><dd>${esc(r.fingerprint)}</dd></div>
<div><dt>Period</dt><dd>${esc(r.periodLabel)}</dd></div>
<div><dt>Generated</dt><dd>${esc(r.generatedAt)}</dd></div>
<div><dt>Source</dt><dd>Data from Mitti via safetyculture-mcp</dd></div>
</dl>
</header>
<div class="body">
${opensWithBrief ? (sections[0] ?? "") : ""}
${summary}
${(opensWithBrief ? sections.slice(1) : sections).join("\n")}
</div>
<footer>Computed locally from cached Mitti Data Feeds by safetyculture-mcp. Organisation shown as a fingerprint, not a name. Figures reflect the cache at generation time; see the data coverage notes. Independent open-source project, not affiliated with SafetyCulture Pty Ltd or Mitti.</footer>
</main>
</body>
</html>
`;
}
