import { fmt, humanDates, judge, shortBucket, type Block, type Chart } from "./model.js";
import {
  GRAY,
  GRAY_DARK,
  HIVIS,
  HIVIS_DEEP,
  INK,
  INK_2,
  LINE,
  PAPER,
  RAMP_BAD,
  RAMP_DARK_FROM,
  RAMP_NEUTRAL,
  RISK,
  TONE,
  esc as escRaw,
  f1,
  fitText,
  niceMax,
  textW,
  ticks,
} from "./tokens.js";

/**
 * Inline SVG exhibits. Every renderer lays out for a given width W in CSS pixels (the report renders
 * each exhibit twice, at the desktop/print width and at phone width, and CSS shows the one that fits),
 * so text is drawn at its true size: tick labels 11.5px, data labels 12px. Margins come from estimated
 * label widths (tokens.textW), long labels are ellipsised with the full text in a <title>, and nothing
 * is rotated.
 */

/** Exhibit widths: desktop and print (A4 content width is about 690px, so print scales by ~0.9), and phone. */
export const WIDE = 760;
export const NARROW = 358;

/** Escapes SVG text (labels, tooltips) and writes any ISO date in the report's one human format. */
const esc = (s: unknown): string => escRaw(humanDates(String(s ?? "")));

// 12px in the 760px layout prints at about 10.9px (8.1pt) on A4 (182mm content width), above the 8pt floor.
export const TICK = 12;
export const LABEL = 12;
/** A4 portrait content width at 96 dpi with 14mm margins: 210mm - 28mm = 182mm. */
export const A4_CONTENT_PX = (182 / 25.4) * 96;
const PARTIAL_OPACITY = 0.32;

type Visual = Extract<Block, { kind: "bars" | "stacked" | "dumbbell" | "heatmap" | "multiples" | "bullets" }>;

const open = (W: number, H: number, label: string) =>
  `<svg viewBox="0 0 ${W} ${Math.ceil(H)}" width="${W}" height="${Math.ceil(H)}" role="img" aria-label="${esc(label)}" font-family="inherit"><title>${esc(label)}</title>`;
const text = (x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: "start" | "middle" | "end"; weight?: number; full?: string } = {}) =>
  `<text x="${f1(x)}" y="${f1(y)}"${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""} font-size="${o.size ?? TICK}" fill="${o.fill ?? INK_2}"${o.weight ? ` font-weight="${o.weight}"` : ""}>${o.full && o.full !== s ? `<title>${esc(o.full)}</title>` : ""}${esc(s)}</text>`;
const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Inline legend rows (swatch + label), wrapped to the width. Returns the markup and its height. */
function legend(items: Array<{ label: string; swatch: string }>, W: number, y0: number): { svg: string; h: number } {
  let x = 0;
  let y = y0;
  const out: string[] = [];
  for (const it of items) {
    const w = 16 + textW(it.label, TICK) + 16;
    if (x > 0 && x + w > W) {
      x = 0;
      y += 18;
    }
    out.push(`<g transform="translate(${f1(x)} ${f1(y)})">${it.swatch}${text(16, 9.5, it.label)}</g>`);
    x += w;
  }
  return { svg: out.join(""), h: items.length ? y - y0 + 18 : 0 };
}
const square = (fill: string) => `<rect x="0" y="0" width="10" height="10" rx="2" fill="${fill}"/>`;
const dot = (filled: boolean, color = INK) => `<circle cx="5" cy="5" r="4" fill="${filled ? color : PAPER}" stroke="${filled ? color : GRAY_DARK}" stroke-width="1.75"/>`;
const rule = (color: string, dash = false) => `<line x1="0" x2="11" y1="5" y2="5" stroke="${color}" stroke-width="2.5"${dash ? ' stroke-dasharray="3 2"' : ""}/>`;

/** Label column width: the longest label, capped at a share of the width. */
const labelCol = (labels: string[], W: number, cap = 0.36) => Math.ceil(Math.min(W * (W < 500 ? Math.max(cap, 0.52) : cap), Math.max(40, ...labels.map((l) => textW(l, LABEL)))));

// ---------------- sorted horizontal bars ----------------

function barsSvg(b: Extract<Visual, { kind: "bars" }>, W: number): string {
  const unit = b.unit ?? "";
  // The highlight never lands on a row with too few observations to rate.
  const want = b.highlight ?? 0;
  const hi = b.rows[want]?.muted ? -1 : want;
  const pitch = 28;
  const T = 4;
  const valText = (v: number | null) => (finite(v) ? fmt(v, unit) : "n/a");
  const widthOf = (withNotes: boolean) => Math.max(...b.rows.map((r) => textW(valText(r.value), LABEL, true) + (withNotes && r.note ? 6 + textW(r.note, TICK) : 0)));
  let lw = labelCol(b.rows.map((r) => r.label), W, 0.38);
  // Context notes are dropped (they stay in the Markdown twin and tooltips) when they would squeeze the labels or bars.
  const notes = W - lw - 12 - (Math.ceil(widthOf(true)) + 10) >= 120;
  const R = Math.ceil(widthOf(notes)) + 10;
  if (W - lw - 12 - R < 80) lw = Math.max(60, W - R - 12 - 80);
  const L = lw + 12;
  const pw = W - L - R;
  const max = niceMax(Math.max(0, ...b.rows.map((r) => r.value).filter(finite))) || 1;
  const H = T + b.rows.length * pitch + 4;
  const parts: string[] = [];
  b.rows.forEach((r, i) => {
    const y = T + i * pitch;
    const mid = y + pitch / 2;
    const isHi = i === hi;
    parts.push(text(0, mid + 4, fitText(r.label, lw, LABEL, isHi), { size: LABEL, fill: r.muted ? INK_2 : INK, weight: isHi ? 600 : undefined, full: r.label }));
    const w = finite(r.value) ? Math.max(r.value > 0 ? 1.5 : 0, (Math.max(0, r.value) / max) * pw) : 0;
    const fill = isHi ? INK : r.muted ? TONE.pale.fill : GRAY;
    if (w > 0) parts.push(`<rect x="${L}" y="${f1(mid - 8)}" width="${f1(w)}" height="16" rx="2" fill="${fill}"${r.muted ? ` stroke="${GRAY}" stroke-dasharray="3 2"` : ""}><title>${esc(r.label)}: ${esc(valText(r.value))}${r.note ? ` (${esc(r.note)})` : ""}</title></rect>`);
    const vx = L + w + 6;
    parts.push(
      `<text x="${f1(vx)}" y="${f1(mid + 4)}" font-size="${LABEL}" fill="${r.muted ? INK_2 : INK}" font-weight="${isHi ? 650 : r.muted ? 400 : 500}">${esc(valText(r.value))}${notes && r.note ? `<tspan fill="${INK_2}" font-weight="400" font-size="${TICK}" dx="6">${esc(r.note)}</tspan>` : ""}</text>`,
    );
  });
  parts.push(`<line x1="${L}" x2="${L}" y1="${T}" y2="${H - 4}" stroke="${INK_2}"/>`);
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

// ---------------- stacked horizontal bars ----------------

function stackedSvg(b: Extract<Visual, { kind: "stacked" }>, W: number): string {
  const lg = legend(b.segments.map((s) => ({ label: s.label, swatch: square(TONE[s.tone].fill) })), W, 0);
  const T = lg.h + 8;
  const pitch = 30;
  const totals = b.rows.map((r) => r.values.reduce((a, v) => a + (finite(v) ? v : 0), 0));
  const totText = (t: number) => (b.percent ? `n ${fmt(t)}` : fmt(t));
  const R = Math.ceil(Math.max(...totals.map((t) => textW(totText(t), LABEL, true)))) + 10;
  let lw = labelCol(b.rows.map((r) => r.label), W, 0.34);
  if (W - lw - 12 - R < 120) lw = Math.max(60, W - R - 12 - 120);
  const L = lw + 12;
  const pw = W - L - R;
  const maxTotal = Math.max(1, ...totals);
  const H = T + b.rows.length * pitch + 2;
  const parts: string[] = [lg.svg];
  b.rows.forEach((r, i) => {
    const y = T + i * pitch;
    const mid = y + pitch / 2;
    const total = totals[i]!;
    parts.push(text(0, mid + 4, fitText(r.label, lw, LABEL), { size: LABEL, fill: r.muted ? INK_2 : INK, full: r.label }));
    const scale = b.percent ? (total > 0 ? pw / total : 0) : pw / maxTotal;
    // Rows with too few observations to rate have faded fills (so the eye does not read them as findings);
    // their counts stay in ink on top of the faded colour so they remain legible.
    if (r.muted) parts.push(`<g opacity="0.38">`);
    const labels: string[] = [];
    let x = L;
    r.values.forEach((v, k) => {
      if (!finite(v) || v <= 0) return;
      const seg = b.segments[k]!;
      const w = v * scale;
      parts.push(`<rect x="${f1(x)}" y="${f1(mid - 9)}" width="${f1(Math.max(1, w - 1))}" height="18" fill="${TONE[seg.tone].fill}"><title>${esc(r.label)}: ${esc(seg.label)} ${esc(fmt(v))}</title></rect>`);
      const s = fmt(v);
      if (w - 1 >= textW(s, TICK, true) + 8) labels.push(text(x + (w - 1) / 2, mid + 4, s, { anchor: "middle", fill: r.muted ? INK : TONE[seg.tone].text, weight: 600 }));
      x += w;
    });
    if (r.muted) parts.push(`</g>`);
    parts.push(...labels);
    if (total === 0) parts.push(text(L, mid + 4, "none", { fill: INK_2 }));
    parts.push(text(W - R + 8, mid + 4, totText(total), { size: LABEL, fill: r.muted ? INK_2 : INK, weight: r.muted ? 400 : 600 }));
  });
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

// ---------------- dumbbell ----------------

function dumbbellSvg(b: Extract<Visual, { kind: "dumbbell" }>, W: number): string {
  const unit = b.unit ?? "";
  const items = [
    { label: b.fromLabel, swatch: dot(false) },
    { label: b.toLabel, swatch: dot(true) },
    ...(b.good ? [{ label: "worse", swatch: rule(RISK) }, { label: "better", swatch: rule(INK) }] : []),
  ];
  const lg = legend(items, W, 0);
  const T = lg.h + 10;
  const pitch = 28;
  const vals = b.rows.flatMap((r) => [r.from, r.to]).filter(finite);
  if (b.target) vals.push(b.target.value);
  const max = unit === "%" && Math.max(0, ...vals) > 50 ? 100 : niceMax(Math.max(0, ...vals));
  const labelOf = (r: (typeof b.rows)[number]) => (finite(r.to) ? fmt(r.to, unit) : "n/a");
  const valW = Math.max(...b.rows.map((r) => textW(labelOf(r), LABEL, true)));
  const R = Math.ceil(valW) + 14;
  // Rows whose current value is below the previous one carry their label on the left of the filled dot:
  // reserve that room inside the plot so the label always belongs to the current ("filled") dot.
  const padL = Math.ceil(Math.max(0, ...b.rows.filter((r) => finite(r.to) && finite(r.from) && r.to! < r.from!).map((r) => textW(labelOf(r), LABEL, true) + 12)));
  let lw = labelCol(b.rows.map((r) => r.label), W, 0.34);
  if (W - lw - 16 - R - padL < 100) lw = Math.max(60, W - R - 16 - padL - 100);
  const L = lw + 16;
  const x0 = L + padL;
  const pw = W - x0 - R;
  const x = (v: number) => x0 + (Math.max(0, v) / max) * pw;
  const plotBottom = T + b.rows.length * pitch;
  const H = plotBottom + 22;
  const parts: string[] = [lg.svg];
  // Thin the ticks until neighbouring labels clear each other (4, then 2, then 1 interval).
  const tickW = Math.max(...ticks(max, 4).map((t) => textW(`${fmt(t)}${unit}`, TICK))) + 12;
  const intervals = pw / 4 >= tickW ? 4 : pw / 2 >= tickW ? 2 : 1;
  for (const t of ticks(max, intervals)) {
    const xx = x(t);
    parts.push(`<line x1="${f1(xx)}" x2="${f1(xx)}" y1="${T}" y2="${plotBottom}" stroke="${LINE}"/>`);
    parts.push(text(xx, plotBottom + 16, `${fmt(t)}${unit}`, { anchor: t === 0 && padL < 8 ? "start" : "middle" }));
  }
  if (b.target) {
    const tx = x(b.target.value);
    parts.push(`<line x1="${f1(tx)}" x2="${f1(tx)}" y1="${T - 4}" y2="${plotBottom}" stroke="${HIVIS_DEEP}" stroke-width="2"/>`);
    const tw = textW(b.target.label, TICK, true);
    parts.push(text(tx + tw + 4 > W ? tx - 4 : tx + 4, T - 6, b.target.label, { fill: HIVIS_DEEP, weight: 600, anchor: tx + tw + 4 > W ? "end" : "start" }));
  }
  b.rows.forEach((r, i) => {
    const mid = T + i * pitch + pitch / 2;
    parts.push(text(0, mid + 4, fitText(r.label, lw, LABEL), { size: LABEL, fill: r.muted ? INK_2 : INK, full: r.label }));
    const verdict = judge(r.from, r.to, b.good);
    const color = r.muted ? GRAY : verdict === "worse" ? RISK : verdict === "better" || !b.good ? INK : GRAY_DARK;
    const tip = `${r.label}: ${b.fromLabel} ${fmt(r.from, unit)}, ${b.toLabel} ${fmt(r.to, unit)}`;
    if (finite(r.from) && finite(r.to)) parts.push(`<line x1="${f1(x(r.from))}" x2="${f1(x(r.to))}" y1="${f1(mid)}" y2="${f1(mid)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`);
    if (finite(r.from)) parts.push(`<circle cx="${f1(x(r.from))}" cy="${f1(mid)}" r="5" fill="${PAPER}" stroke="${GRAY_DARK}" stroke-width="2"><title>${esc(tip)}</title></circle>`);
    if (finite(r.to)) parts.push(`<circle cx="${f1(x(r.to))}" cy="${f1(mid)}" r="5.5" fill="${color}"><title>${esc(tip)}</title></circle>`);
    // The value label sits on the outer side of the current dot, so it never reads as the previous value.
    const label = labelOf(r);
    const right = Math.max(finite(r.from) ? x(r.from) : x0, finite(r.to) ? x(r.to) : x0);
    const fill = r.muted ? INK_2 : finite(r.to) ? color : INK_2;
    if (finite(r.to) && finite(r.from) && r.to < r.from) parts.push(text(x(r.to) - 10, mid + 4, label, { size: LABEL, fill, weight: 600, anchor: "end" }));
    else parts.push(text(right + 10, mid + 4, label, { size: LABEL, fill, weight: 600 }));
  });
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

// ---------------- heatmap ----------------

function heatmapSvg(b: Extract<Visual, { kind: "heatmap" }>, W: number): string {
  const cols = b.columns.map((c, i) => `${shortBucket(c)}${b.partial?.[i] ? "†" : ""}`);
  const colW = Math.max(...cols.map((c) => textW(c, TICK)));
  // Heatmaps keep a narrow label column so cells stay at least 14px wide on phones.
  const lw = Math.ceil(Math.min(W * 0.34, Math.max(40, ...b.rows.map((r) => textW(r.label, LABEL)))));
  const L = lw + 10;
  const R = Math.ceil(Math.max(4, colW / 2 - 8));
  const n = Math.max(1, cols.length);
  const cw = (W - L - R) / n;
  const ch = 24;
  const T = 22;
  const vals = b.rows.flatMap((r) => r.values).filter(finite);
  const max = b.max ?? niceMax(Math.max(0, ...vals));
  // One decimal discipline per matrix: if any cell carries decimals, every cell shows the same count.
  const dp = Math.min(2, Math.max(0, ...vals.map((v) => (String(v).split(".")[1] ?? "").length)));
  const ramp = b.good ? RAMP_BAD : RAMP_NEUTRAL;
  const dense = b.good === "up" && vals.length > 40;
  const step = (v: number) => {
    const t = max > 0 ? Math.min(1, Math.max(0, v / max)) : 0;
    const bad = b.good === "up" ? 1 - t : t;
    return Math.min(4, Math.floor(bad * 5));
  };
  const parts: string[] = [];
  const every = Math.max(1, Math.ceil((colW + 6) / cw));
  cols.forEach((c, i) => {
    if ((n - 1 - i) % every === 0) parts.push(text(L + cw * i + cw / 2, T - 8, c, { anchor: "middle" }));
  });
  b.rows.forEach((r, j) => {
    const y = T + j * ch;
    parts.push(text(0, y + ch / 2 + 4, fitText(r.label, lw, LABEL), { size: LABEL, fill: INK, full: r.label }));
    r.values.forEach((v, i) => {
      const x = L + cw * i;
      const tip = `${r.label}, ${b.columns[i]}: ${fmt(v, b.unit ?? "")}`;
      if (!finite(v)) {
        parts.push(`<rect x="${f1(x + 1)}" y="${f1(y + 1)}" width="${f1(cw - 2)}" height="${ch - 2}" fill="${PAPER}" stroke="${LINE}"><title>${esc(tip)}</title></rect>`);
        parts.push(text(x + cw / 2, y + ch / 2 + 4, "–", { anchor: "middle" }));
        return;
      }
      const s = step(v);
      parts.push(`<rect x="${f1(x + 1)}" y="${f1(y + 1)}" width="${f1(cw - 2)}" height="${ch - 2}" rx="2" fill="${ramp[s]}"><title>${esc(tip)}</title></rect>`);
      const label = dp ? v.toFixed(dp) : fmt(v);
      // Dense "higher is better" matrices (compliance) print values only where they add: every cell except the best step.
      if (dense && s === 0) return;
      if (textW(label, TICK) <= cw - 4) parts.push(text(x + cw / 2, y + ch / 2 + 4, label, { anchor: "middle", fill: s >= RAMP_DARK_FROM ? PAPER : INK }));
    });
  });
  // Scale key: five steps with the meaning of the dark end spelled out.
  const ky = T + b.rows.length * ch + 14;
  const lo = b.good ? "better" : "lower";
  const hiWord = b.good ? "worse" : "higher";
  let kx = L;
  parts.push(text(kx, ky + 9, lo));
  kx += textW(lo, TICK) + 6;
  ramp.forEach((c, i) => parts.push(`<rect x="${f1(kx + i * 20)}" y="${ky}" width="18" height="10" rx="2" fill="${c}"/>`));
  kx += 5 * 20 + 4;
  parts.push(text(kx, ky + 9, hiWord));
  let H = ky + 14;
  if (dense) {
    // On narrow widths the explanation drops to its own line.
    const note = "values omitted in the palest band";
    const nx = kx + textW(hiWord, TICK) + 14;
    if (nx + textW(note, TICK) <= W) parts.push(text(nx, ky + 9, note));
    else {
      parts.push(text(L, ky + 27, note));
      H += 18;
    }
  }
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

// ---------------- small multiples ----------------

function multiplesSvg(b: Extract<Visual, { kind: "multiples" }>, W: number): string {
  const unit = b.unit ?? "";
  const gap = 18;
  const cols = Math.max(1, Math.min(b.panels.length, Math.floor((W + gap) / (168 + gap))));
  const pw = (W - (cols - 1) * gap) / cols;
  const ph = 80;
  const rowsN = Math.ceil(b.panels.length / cols);
  const vals = b.panels.flatMap((p) => p.values).filter(finite);
  const max = b.yMax ?? niceMax(Math.max(0, ...vals));
  const n = Math.max(2, b.xLabels.length);
  const parts: string[] = [];
  b.panels.forEach((p, k) => {
    const ox = (k % cols) * (pw + gap);
    const oy = Math.floor(k / cols) * (ph + 6);
    const last = [...p.values].reverse().find(finite);
    const lastText = finite(last) ? fmt(last, unit) : "n/a";
    const lastW = textW(lastText, LABEL, true);
    const title = fitText(p.label, pw - lastW - 10, LABEL, p.highlight);
    if (p.highlight) parts.push(`<rect x="${f1(ox - 2)}" y="${oy + 1}" width="${f1(textW(title, LABEL, true) + 4)}" height="16" fill="${HIVIS}"/>`);
    parts.push(text(ox, oy + 13, title, { size: LABEL, fill: INK, weight: p.highlight ? 650 : 500, full: p.label }));
    parts.push(text(ox + pw, oy + 13, lastText, { size: LABEL, fill: INK, weight: 650, anchor: "end" }));
    const top = oy + 24;
    const bottom = oy + ph - 8;
    const x = (i: number) => ox + 3 + (i / (n - 1)) * (pw - 6);
    const y = (v: number) => bottom - (Math.max(0, v) / max) * (bottom - top);
    parts.push(`<line x1="${f1(ox)}" x2="${f1(ox + pw)}" y1="${f1(top)}" y2="${f1(top)}" stroke="${LINE}" stroke-dasharray="2 3"/>`);
    parts.push(`<line x1="${f1(ox)}" x2="${f1(ox + pw)}" y1="${f1(bottom)}" y2="${f1(bottom)}" stroke="${INK_2}"/>`);
    const color = p.highlight ? INK : GRAY_DARK;
    const solid: string[] = [];
    const dashed: string[] = [];
    p.values.forEach((v, i) => {
      const prev = p.values[i - 1];
      if (i === 0 || !finite(v) || !finite(prev)) return;
      const seg = `M${f1(x(i - 1))} ${f1(y(prev))}L${f1(x(i))} ${f1(y(v))}`;
      (b.partial?.[i] || b.partial?.[i - 1] ? dashed : solid).push(seg);
    });
    if (solid.length) parts.push(`<path d="${solid.join("")}" fill="none" stroke="${color}" stroke-width="${p.highlight ? 2.25 : 1.75}" stroke-linejoin="round"/>`);
    if (dashed.length) parts.push(`<path d="${dashed.join("")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3"/>`);
    const li = p.values.length - 1 - [...p.values].reverse().findIndex(finite);
    if (finite(last) && li >= 0) parts.push(`<circle cx="${f1(x(li))}" cy="${f1(y(last))}" r="3" fill="${b.partial?.[li] ? PAPER : color}" stroke="${color}" stroke-width="1.5"><title>${esc(p.label)}, ${esc(b.xLabels[li] ?? "")}: ${esc(lastText)}</title></circle>`);
  });
  // x range under the bottom row only (first and last bucket)
  const ly = (rowsN - 1) * (ph + 6) + ph + 8;
  const first = shortBucket(b.xLabels[0] ?? "");
  const lastL = `${shortBucket(b.xLabels[b.xLabels.length - 1] ?? "")}${b.partial?.[b.xLabels.length - 1] ? "†" : ""}`;
  for (let c = 0; c < cols; c++) {
    const ox = c * (pw + gap);
    parts.push(text(ox, ly, first));
    parts.push(text(ox + pw, ly, lastL, { anchor: "end" }));
  }
  const H = ly + 4;
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

// ---------------- bullets ----------------

function bulletsSvg(b: Extract<Visual, { kind: "bullets" }>, W: number): string {
  const lg = legend(
    [
      { label: "this period", swatch: `<rect x="0" y="3" width="11" height="5" fill="${INK}"/>` },
      { label: b.compareLabel, swatch: `<line x1="5" x2="5" y1="-1" y2="11" stroke="${INK_2}" stroke-width="2.5"/>` },
      // Only when the caller supplied a target; nothing is drawn otherwise.
      ...(b.rows.some((r) => finite(r.target)) ? [{ label: "target", swatch: `<path d="M5 -1l4 6-4 6-4-6z" fill="${HIVIS_DEEP}"/>` }] : []),
    ],
    W,
    0,
  );
  const T = lg.h + 8;
  const pitch = 36;
  const valText = (r: (typeof b.rows)[number]) => (finite(r.value) ? fmt(r.value, r.unit ?? "") : "n/a");
  const R = Math.ceil(Math.max(...b.rows.map((r) => textW(valText(r), LABEL, true) + (r.note ? 6 + textW(r.note, TICK) : 0)))) + 12;
  let lw = labelCol(b.rows.map((r) => r.label), W, 0.32);
  if (W - lw - 12 - R < 110) lw = Math.max(60, W - R - 12 - 110);
  const L = lw + 12;
  const pw = W - L - R;
  const H = T + b.rows.length * pitch;
  const parts: string[] = [lg.svg];
  b.rows.forEach((r, i) => {
    const mid = T + i * pitch + pitch / 2;
    const x = (v: number) => L + (Math.min(r.max, Math.max(0, v)) / (r.max || 1)) * pw;
    parts.push(text(0, mid + 4, fitText(r.label, lw, LABEL), { size: LABEL, fill: INK, full: r.label }));
    parts.push(`<rect x="${L}" y="${f1(mid - 8)}" width="${f1(pw)}" height="16" rx="2" fill="${LINE}"/>`);
    const verdict = judge(r.compare, r.value, r.good);
    if (finite(r.value)) parts.push(`<rect x="${L}" y="${f1(mid - 3.5)}" width="${f1(Math.max(1, x(r.value) - L))}" height="7" fill="${verdict === "worse" ? RISK : INK}"><title>${esc(r.label)}: ${esc(valText(r))}</title></rect>`);
    if (finite(r.compare)) parts.push(`<line x1="${f1(x(r.compare))}" x2="${f1(x(r.compare))}" y1="${f1(mid - 11)}" y2="${f1(mid + 11)}" stroke="${INK_2}" stroke-width="2.5"><title>${esc(b.compareLabel)}: ${esc(fmt(r.compare, r.unit ?? ""))}</title></line>`);
    if (finite(r.target)) parts.push(`<path d="M${f1(x(r.target))} ${f1(mid - 13)}l5 7-5 7-5-7z" fill="${HIVIS_DEEP}" stroke="${PAPER}" stroke-width="1"><title>target: ${esc(fmt(r.target, r.unit ?? ""))}</title></path>`);
    parts.push(
      `<text x="${f1(W - R + 10)}" y="${f1(mid + 4)}" font-size="${LABEL}" fill="${verdict === "worse" ? RISK : INK}" font-weight="650">${esc(valText(r))}${r.note ? `<tspan fill="${INK_2}" font-weight="400" font-size="${TICK}" dx="6">${esc(r.note)}</tspan>` : ""}</text>`,
    );
  });
  return `${open(W, H, b.title)}${parts.join("")}</svg>`;
}

export function visualSvg(b: Visual, W: number): string {
  switch (b.kind) {
    case "bars":
      return barsSvg(b, W);
    case "stacked":
      return stackedSvg(b, W);
    case "dumbbell":
      return dumbbellSvg(b, W);
    case "heatmap":
      return heatmapSvg(b, W);
    case "multiples":
      return multiplesSvg(b, W);
    case "bullets":
      return bulletsSvg(b, W);
  }
}

export const visualEmpty = (b: Visual): boolean =>
  b.kind === "multiples" ? !b.panels.length : b.rows.length === 0;

// ---------------- column / line / pareto ----------------

export function chartSvg(c: Chart, W = WIDE): string {
  const H = Math.max(210, Math.round(W / 2.4));
  const unit = c.unit ?? "";
  const vals = c.points.map((p) => p.value).filter(finite);
  const s2 = c.series2?.values ?? [];
  const tgt = c.target && finite(c.target.value) ? [c.target.value] : [];
  const yMax = c.yMax ?? niceMax(Math.max(0, ...vals, ...s2.filter(finite), ...tgt));
  // Lines of a percentage that sits high (scores) get a zoomed axis with an explicit break marker;
  // bars always start at zero. A target stays inside the zoomed window.
  const vMin = Math.min(...vals, ...s2.filter(finite), ...tgt);
  // Spans paired with interval counts that give round ticks (step 2, 5, 10 or 10).
  const zoom = c.kind === "line" && unit === "%" && yMax === 100 && vals.length ? [{ s: 10, k: 5 }, { s: 20, k: 4 }, { s: 30, k: 3 }, { s: 40, k: 4 }, { s: 50, k: 5 }].find((z) => 100 - z.s <= vMin - 2) : undefined;
  const span = zoom?.s;
  const yMin = span ? 100 - span : 0;
  const intervals = zoom ? zoom.k : unit === "%" ? 4 : ([4, 5, 2, 3].find((k) => Number.isInteger(yMax / k)) ?? 4);
  const yt = ticks(yMax - yMin, intervals).map((t) => Math.round((t + yMin) * 10) / 10);
  const yLabelW = Math.max(...yt.map((v) => textW(`${fmt(v)}${unit}`, TICK)));
  const xl = c.points.map((p) => `${shortBucket(p.label)}${p.partial ? "†" : ""}`);
  const xw = Math.max(0, ...xl.map((l) => textW(l, TICK)));
  const lastVal = [...c.points].reverse().find((p) => finite(p.value))?.value ?? null;
  const lastIdx = c.points.length - 1 - [...c.points].reverse().findIndex((p) => finite(p.value));
  const endMain = c.kind === "line" && finite(lastVal) ? `${fmt(lastVal, unit)}${c.series2 && c.seriesLabel ? ` ${c.seriesLabel}` : ""}` : "";
  const last2 = [...s2].reverse().find(finite);
  const end2 = c.kind === "line" && c.series2 && finite(last2) ? `${fmt(last2, unit)} ${c.series2.label}` : "";
  let R = c.kind === "pareto" ? Math.ceil(textW("100%", TICK)) + 10 : 12;
  if (endMain || end2) R = Math.max(R, Math.ceil(Math.max(textW(endMain, LABEL, true), textW(end2, LABEL))) + 12);
  R = Math.max(R, Math.ceil(xw / 2) + 2);
  const L = Math.max(Math.ceil(yLabelW) + 10, Math.ceil(xw / 2) + 2);
  const T = c.markers?.length ? 38 : 26;
  const B = 40;
  const pw = W - L - R;
  const ph = H - T - B;
  const n = Math.max(1, c.points.length);
  const step = pw / n;
  const x = (i: number) => L + step * i + step / 2;
  const y = (v: number) => T + ph - ((Math.max(yMin, Math.min(v, yMax)) - yMin) / (yMax - yMin)) * ph;
  const parts: string[] = [];

  // axis captions, horizontal: unit/measure top-left, cumulative share top-right (pareto)
  parts.push(text(0, 12, c.yLabel, { fill: INK_2 }));
  if (c.kind === "pareto") parts.push(text(W, 12, "Cumulative share (dashed)", { anchor: "end" }));
  for (const v of yt) {
    const yy = y(v);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${f1(yy)}" y2="${f1(yy)}" stroke="${v === yMin ? INK_2 : LINE}"/>`);
    parts.push(text(L - 6, yy + 4, `${fmt(v)}${unit}`, { anchor: "end" }));
  }
  if (yMin > 0) {
    // axis break: a white gap with two slashes on the baseline, and the word in the caption
    const by = T + ph;
    parts.push(`<rect x="${L - 1}" y="${f1(by - 7)}" width="10" height="9" fill="${PAPER}"/><path d="M${L - 3} ${f1(by + 1)}l6 -7M${L + 3} ${f1(by + 1)}l6 -7" stroke="${INK_2}" stroke-width="1.5"/>`);
    parts.push(text(textW(c.yLabel, TICK) + 8, 12, `(axis starts at ${fmt(yMin)}${unit})`));
  }
  const every = Math.max(1, Math.ceil((xw + 8) / step));
  c.points.forEach((_, i) => {
    if ((n - 1 - i) % every === 0) parts.push(text(x(i), T + ph + 17, xl[i]!, { anchor: "middle" }));
  });
  parts.push(text(L + pw / 2, H - 4, c.xLabel, { anchor: "middle" }));

  if (c.reference && finite(c.reference.value)) {
    const yy = y(c.reference.value);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${f1(yy)}" y2="${f1(yy)}" stroke="${INK_2}" stroke-dasharray="5 4"/>`);
    parts.push(`<text x="${L + 4}" y="${f1(yy - 5)}" font-size="${TICK}" fill="${INK_2}" paint-order="stroke" stroke="${PAPER}" stroke-width="3">${esc(c.reference.label)}</text>`);
  }
  if (c.target && finite(c.target.value)) {
    const yy = y(c.target.value);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${f1(yy)}" y2="${f1(yy)}" stroke="${HIVIS_DEEP}" stroke-width="2"/>`);
    parts.push(`<text x="${W - R - 4}" y="${f1(yy - 5)}" text-anchor="end" font-size="${TICK}" font-weight="600" fill="${HIVIS_DEEP}" paint-order="stroke" stroke="${PAPER}" stroke-width="3">${esc(c.target.label)}</text>`);
  }
  for (const m of c.markers ?? []) {
    if (m.index < 0 || m.index >= n) continue;
    const xx = x(m.index);
    parts.push(`<line x1="${f1(xx)}" x2="${f1(xx)}" y1="${T - 6}" y2="${T + ph}" stroke="${INK}" stroke-dasharray="3 3"/>`);
    const w = textW(m.label, TICK, true);
    const anchor = xx - w / 2 < 0 ? "start" : xx + w / 2 > W ? "end" : "middle";
    parts.push(text(anchor === "start" ? Math.max(0, xx - 4) : anchor === "end" ? Math.min(W, xx + 4) : xx, T - 10, m.label, { anchor, fill: INK, weight: 600 }));
  }

  if (c.kind === "bar" || c.kind === "pareto") {
    const bw = Math.max(2, step * 0.62);
    c.points.forEach((p, i) => {
      if (!finite(p.value)) return;
      const top = y(p.value);
      const partial = p.partial === true;
      const isHi = c.highlight === undefined || c.highlight === i;
      const fill = c.kind === "pareto" ? (i === 0 ? INK : GRAY_DARK) : isHi ? INK : GRAY;
      const opacity = partial ? PARTIAL_OPACITY : 1;
      parts.push(`<rect x="${f1(x(i) - bw / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(T + ph - top)}" rx="2" fill="${fill}" opacity="${opacity}"><title>${esc(p.label)}: ${esc(fmt(p.value, unit))}${partial ? " (partial)" : ""}</title></rect>`);
      if (c.highlight === i) parts.push(text(x(i), top - 6, fmt(p.value, unit), { anchor: "middle", size: LABEL, fill: INK, weight: 650 }));
    });
  }
  if (c.kind === "line") {
    const drawSeries = (values: Array<number | null>, color: string, width: number, dots: boolean) => {
      const solid: string[] = [];
      const dashed: string[] = [];
      values.forEach((v, i) => {
        const prev = values[i - 1];
        if (i === 0 || !finite(v) || !finite(prev)) return;
        const seg = `M${f1(x(i - 1))} ${f1(y(prev))}L${f1(x(i))} ${f1(y(v))}`;
        (c.points[i]?.partial || c.points[i - 1]?.partial ? dashed : solid).push(seg);
      });
      if (solid.length) parts.push(`<path d="${solid.join("")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`);
      if (dashed.length) parts.push(`<path d="${dashed.join("")}" fill="none" stroke="${color}" stroke-width="${width - 0.5}" stroke-dasharray="4 3"/>`);
      if (dots)
        values.forEach((v, i) => {
          if (!finite(v)) return;
          const partial = c.points[i]?.partial === true;
          parts.push(`<circle cx="${f1(x(i))}" cy="${f1(y(v))}" r="3" fill="${PAPER}" stroke="${color}" stroke-width="2"${partial ? ' stroke-dasharray="2 1.5"' : ""}><title>${esc(c.points[i]?.label ?? "")}: ${esc(fmt(v, unit))}${partial ? " (partial)" : ""}</title></circle>`);
        });
    };
    if (c.series2) drawSeries(c.series2.values, GRAY_DARK, 2, false);
    drawSeries(c.points.map((p) => p.value), INK, 2.25, c.points.length <= 40);
    // direct end labels, nudged apart when they would collide
    let yMain = finite(lastVal) ? y(lastVal) + 4 : NaN;
    let y2 = finite(last2) ? y(last2) + 4 : NaN;
    if (Number.isFinite(yMain) && Number.isFinite(y2) && Math.abs(yMain - y2) < 15) {
      const midY = (yMain + y2) / 2;
      if (yMain <= y2) [yMain, y2] = [midY - 7.5, midY + 7.5];
      else [yMain, y2] = [midY + 7.5, midY - 7.5];
    }
    const ex = x(Math.max(0, lastIdx)) + 8;
    if (endMain) parts.push(text(ex, yMain, endMain, { size: LABEL, fill: INK, weight: 650 }));
    if (end2) {
      const i2 = s2.length - 1 - [...s2].reverse().findIndex(finite);
      parts.push(text(x(i2) + 8, y2, end2, { size: LABEL, fill: GRAY_DARK }));
    }
  }
  if (c.kind === "pareto" && c.cumulative?.length) {
    const yc = (v: number) => T + ph - (Math.min(100, Math.max(0, v)) / 100) * ph;
    const d = c.cumulative.map((v, i) => `${i ? "L" : "M"}${f1(x(i))} ${f1(yc(v))}`).join(" ");
    parts.push(`<path d="${d}" fill="none" stroke="${INK_2}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    for (const k of [0, 50, 100]) parts.push(text(W - R + 6, yc(k) + 4, `${k}%`));
  }
  if (!vals.length) parts.push(text(L + pw / 2, T + ph / 2, "No data in this period", { anchor: "middle", size: 12 }));
  return `${open(W, H, c.title)}${parts.join("")}</svg>`;
}

/** KPI sparkline: no text, so it scales freely. The last point is a dot (hollow when its bucket is partial). */
export function sparkSvg(values: Array<number | null>, partial: boolean[] = []): string {
  const W = 132;
  const H = 30;
  const vals = values.filter(finite);
  if (vals.length < 2) return "";
  const max = Math.max(...vals);
  const min = Math.min(0, ...vals);
  const span = max - min || 1;
  const n = values.length;
  const x = (i: number) => 3 + (i / Math.max(1, n - 1)) * (W - 6);
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const solid: string[] = [];
  const dashed: string[] = [];
  values.forEach((v, i) => {
    const prev = values[i - 1];
    if (i === 0 || !finite(v) || !finite(prev)) return;
    (partial[i] || partial[i - 1] ? dashed : solid).push(`M${f1(x(i - 1))} ${f1(y(prev))}L${f1(x(i))} ${f1(y(v))}`);
  });
  const li = n - 1 - [...values].reverse().findIndex(finite);
  const lv = values[li] as number;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"><line x1="0" x2="${W}" y1="${H - 4}" y2="${H - 4}" stroke="${LINE}"/>${solid.length ? `<path d="${solid.join("")}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>` : ""}${dashed.length ? `<path d="${dashed.join("")}" fill="none" stroke="${INK}" stroke-width="1.3" stroke-dasharray="3 2"/>` : ""}<circle cx="${f1(x(li))}" cy="${f1(y(lv))}" r="2.6" fill="${partial[li] ? PAPER : INK}" stroke="${INK}" stroke-width="1.4"/></svg>`;
}
