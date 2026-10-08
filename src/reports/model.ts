/**
 * Report document model. Builders produce a `Report`; html.ts and markdown.ts render it, so both
 * files always carry the same numbers. All strings are plain text here: renderers escape them.
 */

export type Cell = string | number | null | undefined | { text: string; href?: string };

export interface Column {
  label: string;
  align?: "left" | "right";
}

export interface Tile {
  label: string;
  value: number | null;
  unit?: string;
  /** Previous-period value, when compared. */
  previous?: number | null;
  /** Change vs previous, only when both periods have enough observations. */
  delta?: number | null;
  /** Explains a missing delta ("too few to compare") or adds context ("oldest 41 days"). */
  note?: string;
  /** Which direction is good, so the delta can say "better" or "worse". */
  good?: "up" | "down";
}

export interface ChartPoint {
  label: string;
  value: number | null;
}

export interface Chart {
  kind: "bar" | "line" | "pareto";
  title: string;
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
  /** For pareto: cumulative share (0-100) per point. */
  cumulative?: number[];
  unit?: string;
  /** Fix the y axis maximum (e.g. 100 for percentages). */
  yMax?: number;
}

export type Block =
  | { kind: "kpis"; tiles: Tile[] }
  | { kind: "chart"; chart: Chart }
  | { kind: "table"; columns: Column[]; rows: Cell[][]; empty?: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: Array<{ text: string; href?: string }>; empty?: string }
  | { kind: "notes"; title?: string; items: string[] };

export interface Section {
  title: string;
  intro?: string;
  blocks: Block[];
}

export interface Report {
  title: string;
  subtitle?: string;
  fingerprint: string;
  periodLabel: string;
  generatedAt: string;
  sections: Section[];
}

/** Only links into the Mitti web app are rendered; anything else becomes plain text. */
export const SAFE_LINK = /^https:\/\/app\.safetyculture\.com\/[A-Za-z0-9/_\-.?=&%]*$/;
export const safeHref = (href?: string) => (href && SAFE_LINK.test(href) ? href : undefined);

/** Deterministic number formatting: thousands separators, fixed decimals as computed. */
export function fmt(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  const [int, dec] = String(Math.abs(v)).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${v < 0 ? "-" : ""}${grouped}${dec ? `.${dec}` : ""}${unit}`;
}

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return "";
  if (typeof c === "number") return fmt(c);
  if (typeof c === "string") return c;
  return c.text;
}

export function deltaText(t: Tile): string {
  if (t.delta === undefined) return t.note ?? "";
  if (t.delta === null) return t.note ?? "too few to compare";
  const unit = t.unit === "%" ? " pp" : t.unit ?? "";
  const sign = t.delta > 0 ? "+" : "";
  const judged = t.delta === 0 || !t.good ? "" : (t.delta > 0) === (t.good === "up") ? " (better)" : " (worse)";
  return `${sign}${fmt(t.delta)}${unit} vs previous${judged}`;
}
