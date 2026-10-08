import type { Tone } from "./model.js";

/**
 * Brand tokens from DESIGN.md (OKLCH) plus the text geometry the SVG exhibits are laid out with.
 * Text and chart ink sit at hue 250, the hi-vis accent at 122/128, warn at 80 and risk red at 27:
 * no indigo or purple (hue 260-300) anywhere in the output.
 */
export const INK = "oklch(0.21 0.012 250)";
export const INK_2 = "oklch(0.43 0.01 250)";
export const LINE = "oklch(0.9 0.006 250)";
export const HIVIS = "oklch(0.91 0.2 122)";
export const HIVIS_DEEP = "oklch(0.55 0.15 128)";
export const RISK = "oklch(0.58 0.19 27)";
export const RISK_TINT = "oklch(0.95 0.035 27)";
export const WARN = "oklch(0.8 0.15 80)";
export const OK = "oklch(0.72 0.17 150)";
export const PANEL = "oklch(0.2 0.012 250)";
export const PANEL_INK = "oklch(0.94 0.005 250)";
export const PANEL_DIM = "oklch(0.72 0.01 250)";
export const BG = "oklch(0.985 0 0)";
/** Context marks: the gray most bars are drawn in so the highlighted one reads first. */
export const GRAY = "oklch(0.8 0.008 250)";
export const GRAY_DARK = "oklch(0.62 0.01 250)";
export const PAPER = "#fff";

export const TONE: Record<Tone, { fill: string; text: string }> = {
  ink: { fill: INK, text: PAPER },
  mid: { fill: "oklch(0.55 0.01 250)", text: PAPER },
  soft: { fill: "oklch(0.76 0.008 250)", text: INK },
  pale: { fill: "oklch(0.9 0.006 250)", text: INK },
  ok: { fill: OK, text: INK },
  warn: { fill: WARN, text: INK },
  risk: { fill: RISK, text: PAPER },
};

/** Five ranked steps for heatmaps: neutral graphite for intensity, risk red when darker means worse. */
export const RAMP_NEUTRAL = ["oklch(0.96 0.004 250)", "oklch(0.88 0.008 250)", "oklch(0.76 0.01 250)", "oklch(0.6 0.012 250)", "oklch(0.42 0.012 250)"];
export const RAMP_BAD = ["oklch(0.97 0.015 27)", "oklch(0.9 0.05 27)", "oklch(0.8 0.1 27)", "oklch(0.68 0.15 27)", "oklch(0.55 0.17 27)"];
/** Steps from this index up carry white text. */
export const RAMP_DARK_FROM = 3;

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- text geometry ----------
// Reports carry no scripts, so labels cannot be measured with getBBox at view time. Widths are
// estimated per character from the metrics of the system sans stack (Segoe UI / Helvetica / Arial
// class) and rounded up by 8%, so margins computed from them hold the longest label without clipping.

const NARROW = new Set("ijl.,:;'|!`†".split(""));
const SEMI = new Set("frtI()[]-/ ".split(""));
const WIDE = new Set("mwMW%@".split(""));

export function textW(s: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of s) {
    if (NARROW.has(ch)) em += 0.26;
    else if (SEMI.has(ch)) em += 0.35;
    else if (WIDE.has(ch)) em += 0.86;
    else if (ch >= "0" && ch <= "9") em += 0.57;
    else if (ch >= "A" && ch <= "Z") em += 0.67;
    else if (ch >= "a" && ch <= "z") em += 0.54;
    else em += 0.62;
  }
  return em * size * 1.08 * (bold ? 1.06 : 1);
}

/** Ellipsises `s` until it fits `max` px; the full text stays available in the exhibit's tooltip and tables. */
export function fitText(s: string, max: number, size: number, bold = false): string {
  if (textW(s, size, bold) <= max) return s;
  const chars = [...s];
  while (chars.length > 1 && textW(`${chars.join("").trimEnd()}…`, size, bold) > max) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/** Rounds an axis maximum up to 1, 2, 2.5 or 5 x 10^k. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Evenly spaced ticks from 0 to `max` (inclusive), `n` intervals, rounded to one decimal. */
export const ticks = (max: number, n = 4): number[] => Array.from({ length: n + 1 }, (_, k) => Math.round(((max * k) / n) * 10) / 10);

export const f1 = (n: number) => n.toFixed(1);
