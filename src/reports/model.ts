/**
 * Report document model. Builders produce a `Report`; html.ts and markdown.ts render it, so both
 * files always carry the same numbers. All strings are plain text here: renderers escape them.
 */

/**
 * A person's name in a table (assignee, inspector). The `group_kind: "person"` marker makes the report
 * sanitiser pseudonymise `label` at SC_PII=strict, the same rule the analytics rows follow.
 */
export type PersonCell = { label: string; group_kind: "person" };
export type Cell = string | number | null | undefined | { text: string; href?: string } | PersonCell;

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
  /** Recent shape of the same metric (oldest first), drawn as a sparkline. Values come from the trend analytic. */
  spark?: Array<number | null>;
  /** Per spark point: true when its bucket is cut short by the period edge (drawn hollow). */
  sparkPartial?: boolean[];
  /** Caption beside the sparkline, e.g. "last 12 weeks". */
  sparkLabel?: string;
}

export interface ChartPoint {
  label: string;
  value: number | null;
  /** True when a calendar bucket is cut short by the period edges (covers fewer days). */
  partial?: boolean;
}

export interface Chart {
  kind: "bar" | "line" | "pareto";
  /** Action title: states the takeaway. */
  title: string;
  xLabel: string;
  yLabel: string;
  points: ChartPoint[];
  /** For pareto: cumulative share (0-100) per point. */
  cumulative?: number[];
  unit?: string;
  /** Fix the y axis maximum (e.g. 100 for percentages). */
  yMax?: number;
  /** Line under the action title: what is measured, unit and period. */
  subtitle?: string;
  /** Bar charts: the one bar drawn in ink; the others go gray. */
  highlight?: number;
  /** Line charts: event markers (a dashed rule with a short label) at point indexes. */
  markers?: Array<{ index: number; label: string }>;
  /** Horizontal dashed reference line: the pooled period figure from the headline analytic. */
  reference?: { value: number; label: string };
  /** Horizontal solid target line, only when the caller supplied a target (never invented). */
  target?: { value: number; label: string };
  /** Label of the main series, printed at its end when a second series is drawn. */
  seriesLabel?: string;
  /** Line charts: a gray comparison series on the same scale, labelled at its end. */
  series2?: { label: string; values: Array<number | null> };
}

/** One row of a sorted horizontal bar exhibit. */
export interface BarRow {
  label: string;
  value: number | null;
  /** Short context after the value, e.g. "of 40 open". */
  note?: string;
  /** "person" when the label is a person's name (pseudonymised at strict privacy). */
  group_kind?: "person";
  /** Too few observations to rate (below the 20-observation rule): drawn pale, never highlighted. */
  muted?: boolean;
}

/** Segment colours: status colours (ok/warn/risk) are always paired with a legend label. */
export type Tone = "ok" | "warn" | "risk" | "ink" | "mid" | "soft" | "pale";

/** Exhibit header shared by the visual blocks: an action title that states the takeaway, plus the measure. */
export interface Exhibit {
  title: string;
  subtitle?: string;
  /** Footnote under the exhibit. */
  note?: string;
}

export interface StackedRow {
  label: string;
  values: number[];
  group_kind?: "person";
  /** Too few observations to rate: drawn faded. */
  muted?: boolean;
}

export interface DumbbellRow {
  label: string;
  from: number | null;
  to: number | null;
  group_kind?: "person";
  /** Too few observations to rate: drawn gray. */
  muted?: boolean;
}

export interface BulletRow {
  label: string;
  value: number | null;
  compare: number | null;
  unit?: string;
  max: number;
  good?: "up" | "down";
  note?: string;
  /** Caller-supplied target, drawn as a hi-vis tick; absent means no target is shown. */
  target?: number;
}

/** Below this many observations a rate is shown faded and never headlined (the pulse's comparison rule). */
export const MIN_N = 20;

export type Block =
  | { kind: "kpis"; tiles: Tile[] }
  | { kind: "chart"; chart: Chart }
  | { kind: "table"; columns: Column[]; rows: Cell[][]; empty?: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: Array<{ text: string; href?: string }>; empty?: string }
  | { kind: "notes"; title?: string; items: string[] }
  /** Figures withheld because a feed cannot be read: the reason, never a zero. */
  | { kind: "unavailable"; text: string }
  /** Sorted horizontal bars with one highlighted (index, default 0; -1 for none). Rows arrive sorted. */
  | (Exhibit & { kind: "bars"; rows: BarRow[]; valueLabel: string; unit?: string; highlight?: number; empty?: string })
  /** Stacked horizontal bars (status mix). `percent` normalises each row to 100% and prints the row total. */
  | (Exhibit & { kind: "stacked"; segments: Array<{ label: string; tone: Tone }>; rows: StackedRow[]; percent?: boolean; empty?: string })
  /** Two values per entity: previous and current, or expected and actual. */
  | (Exhibit & {
      kind: "dumbbell";
      fromLabel: string;
      toLabel: string;
      unit?: string;
      good?: "up" | "down";
      rows: DumbbellRow[];
      /** Vertical line at a caller-supplied tolerance or target (absent = none drawn). */
      target?: { value: number; label: string };
      empty?: string;
    })
  /** Entity x period matrix. Colour = intensity; with `good`, a darker cell is a worse one. */
  | (Exhibit & {
      kind: "heatmap";
      rowHeader: string;
      columns: string[];
      partial?: boolean[];
      rows: Array<{ label: string; values: Array<number | null> }>;
      unit?: string;
      good?: "up" | "down";
      max?: number;
      empty?: string;
    })
  /** Small multiples: one mini line per entity on a shared scale. */
  | (Exhibit & {
      kind: "multiples";
      xLabels: string[];
      partial?: boolean[];
      panels: Array<{ label: string; values: Array<number | null>; highlight?: boolean }>;
      unit?: string;
      yMax?: number;
      empty?: string;
    })
  /** Bullet bars: a value against a comparison marker (previous period) on a fixed scale. */
  | (Exhibit & { kind: "bullets"; compareLabel: string; rows: BulletRow[] })
  /** Opening brief: three labelled sentences (what changed, what to watch, what we need), built from analytics. */
  | { kind: "brief"; items: Array<{ label: string; text: string }> };

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
  /** Short label for the cover band, e.g. "Monthly board pack". */
  kind?: string;
  /** Executive summary: deterministic sentences built from analytics outputs (no invented numbers). */
  summary?: string[];
  sections: Section[];
}

/** Only links into the Mitti web app are rendered; anything else becomes plain text. */
export const SAFE_LINK = /^https:\/\/app\.safetyculture\.com\/[A-Za-z0-9/_\-.?=&%]*$/;
export const safeHref = (href?: string) => (href && SAFE_LINK.test(href) ? href : undefined);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human timestamp for report headers and coverage tables: "8 Oct 2026, 03:00 UTC". Unparseable input passes through. */
export function fmtInstant(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(d.getTime())) return String(input);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** The one human date format used in every report: "2026-09-01" -> "1 Sep 2026". Anything else passes through. */
export function humanDay(input: string | null | undefined): string {
  const m = String(input ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : String(input ?? "");
}

/** Rewrites ISO dates inside a label: "last month (2026-09-01 to 2026-09-30)" -> "last month (1 Sep 2026 to 30 Sep 2026)". */
export const humanDates = (s: string): string => s.replace(/\b(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z)?\b/g, (d) => humanDay(d));

/** Long form of a trend bucket for tables: "2026-07-13" -> "13 Jul 2026", "2026-07" -> "Jul 2026". */
export function humanBucket(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return humanDay(label);
  const m = label.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : label;
}

/** Short axis label for a trend bucket: "2026-07-13" -> "13 Jul", "2026-07" -> "Jul 26". Anything else passes through. */
export function shortBucket(label: string): string {
  let m = label.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
  m = label.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]!.slice(2)}`;
  return label;
}

/** True when the first or last point only partly overlaps the period. */
export function edgePartial(points: Array<{ partial?: boolean }>): boolean {
  return points.length > 0 && (points[0]?.partial === true || points[points.length - 1]?.partial === true);
}

const partialWord = (xLabel: string): string => (/week/i.test(xLabel) ? "week" : /month/i.test(xLabel) ? "month" : "bucket");

/** Footnote for charts with partial edge buckets. Weekly charts always carry the words "partial week". */
export function partialNote(xLabel: string): string {
  return `† partial ${partialWord(xLabel)}: the first or last bucket covers fewer days, so its count reads lower for that reason alone.`;
}

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
  return "text" in c ? c.text : c.label;
}

export function deltaText(t: Tile): string {
  if (t.delta === undefined) return t.note ?? "";
  if (t.delta === null) return t.note ?? "too few to compare";
  const unit = t.unit === "%" ? " pp" : t.unit ?? "";
  const sign = t.delta > 0 ? "+" : "";
  const judged = t.delta === 0 || !t.good ? "" : (t.delta > 0) === (t.good === "up") ? " (better)" : " (worse)";
  return `${sign}${fmt(t.delta)}${unit} vs previous${judged}`;
}

/** "better" / "worse" / "same" / null (no judgement possible) for a change from `a` to `b`. */
export function judge(a: number | null, b: number | null, good?: "up" | "down"): "better" | "worse" | "same" | null {
  if (a === null || b === null || !good) return null;
  if (a === b) return "same";
  return (b > a) === (good === "up") ? "better" : "worse";
}
