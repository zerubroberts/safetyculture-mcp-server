import { describe, expect, it } from "vitest";
import type { FeedName } from "../../src/cache/contract.js";
import { analyzeActionBacklog } from "../../src/analytics/backlog.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import { addMonths, parsePeriod } from "../../src/core/time.js";
import { buildAuditPack, buildSiteScorecard, failedBar, statusMix } from "../../src/reports/build.js";
import { buildActionBacklog, buildInspectionQuality, buildMonthlyBoardPack, buildScheduleCompliance } from "../../src/reports/build-more.js";
import { renderHtml } from "../../src/reports/html.js";
import { renderMarkdown } from "../../src/reports/markdown.js";
import { MIN_N, humanDates, humanDay, type Block, type Chart, type Report, type Tile } from "../../src/reports/model.js";
import { A4_CONTENT_PX, LABEL, NARROW, TICK, WIDE, visualSvg } from "../../src/reports/svg.js";
import { RISK, RISK_TEXT, RISK_TINT } from "../../src/reports/tokens.js";
import { NOW } from "./fixtures.js";
import { data, fake } from "./org-fixture.js";

/**
 * FIX-REPORT-3: one assertion per finding of the design judge and the data audit.
 * (1) captions and reference lines carry the pooled headline figure, never a mean of buckets;
 * (2) closed vs completed labelled; (3) chip contrast; (4) small samples faded, never headlined;
 * (5) dumbbell labels on the filled dot; (6) print sizes and orphan control; (7) one date format,
 * severity-sorted heatmap; (8) as-of labels and "Items"; (9) opening brief and caller-only targets.
 */

const blocks = (r: Report): Block[] => r.sections.flatMap((s) => s.blocks);
const charts = (r: Report): Chart[] => blocks(r).flatMap((b) => (b.kind === "chart" ? [b.chart] : []));
const tiles = (r: Report): Tile[] => blocks(r).flatMap((b) => (b.kind === "kpis" ? b.tiles : []));
const rangeText = (from: Date, to: Date) => `${from.toISOString().slice(0, 10)}..${new Date(to.getTime() - 86_400_000).toISOString().slice(0, 10)}`;

describe("1. trend captions and reference lines equal the headline figure", () => {
  it("site scorecard: failed-item rate caption and line = the pulse's pooled rate", () => {
    const b = buildSiteScorecard(fake(), { site_id: "site-1" }, NOW);
    const c = charts(b.report).find((x) => x.yLabel === "Failed-item rate")!;
    expect(b.metrics.failed_item_rate).not.toBeNull();
    expect(c.reference!.value).toBe(b.metrics.failed_item_rate);
    expect(c.title).toContain(`period rate ${b.metrics.failed_item_rate}%`);
    expect(c.reference!.label).toBe(`Period rate ${b.metrics.failed_item_rate}%`);
  });

  it("audit pack: score caption and line = its own Average score KPI tile", () => {
    const b = buildAuditPack(fake(), {}, NOW);
    const c = charts(b.report).find((x) => x.yLabel === "Average score")!;
    const tile = tiles(b.report).find((t) => t.label === "Average score")!;
    expect(c.reference!.value).toBe(tile.value);
    expect(c.title).toContain(`${tile.value}%`);
  });

  it("board pack: 12-month caption = the pulse analytic over the same 12 months", () => {
    const b = buildMonthlyBoardPack(fake(), {}, NOW);
    const to = parsePeriod("last month", NOW).to;
    const pooled = safetyPulse(fake(), { period: rangeText(addMonths(to, -12), to) }, NOW).result.table.find((r) => r.metric === "average_score")!.current;
    const c = charts(b.report).find((x) => x.yLabel === "Average score")!;
    expect(c.reference!.value).toBe(pooled);
    expect(b.metrics.score_12_months).toBe(pooled);
    expect(c.title).toContain(`12-month average ${pooled}%`);
  });

  it("no report uses 'averaging' or a 'Mean' line", () => {
    for (const b of [buildSiteScorecard(fake(), { site_id: "site-1" }, NOW), buildAuditPack(fake(), {}, NOW), buildMonthlyBoardPack(fake(), {}, NOW)]) {
      const html = renderHtml(b.report);
      expect(html).not.toMatch(/averaging/i);
      expect(html).not.toMatch(/\bMean \d/);
    }
  });
});

describe("2. closed and completed are labelled apart", () => {
  it("action backlog says 'closed (completed or can't do)' and keeps completed separate", () => {
    const d = data();
    d.actions!.push({ ...d.actions![3]!, id: "a-6", status: "CANT_DO", completed_at: d.actions![3]!.completed_at });
    const c = fake(d);
    const b = buildActionBacklog(c, {}, NOW);
    const m = analyzeActionBacklog(c, { period: "last 90 days" }, NOW).result.metrics;
    expect(m.closed_in_period).toBeGreaterThan(m.completed_in_period as number);
    const closed = tiles(b.report).find((t) => t.label === "Closed (completed or can't do)")!;
    expect(closed.value).toBe(m.closed_in_period);
    expect(tiles(b.report).find((t) => t.label === "Median days to close")!.note).toContain(`over ${m.completed_in_period} completed`);
    const html = renderHtml(b.report);
    expect(html).not.toContain("Closed in period");
    expect(html).toContain("closed (completed or can&#39;t do)");
    expect(renderMarkdown(b.report)).toContain(`${m.completed_in_period} completed`);
  });

  it("audit pack chart title uses the same trend totals it draws", () => {
    const b = buildAuditPack(fake(), {}, NOW);
    const c = charts(b.report).find((x) => x.series2?.label === "created")!;
    const sum = (xs: Array<number | null>) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);
    expect(c.title).toBe(`${sum(c.series2!.values)} actions created and ${sum(c.points.map((p) => p.value))} completed in the period`);
  });
});

/** OKLCH -> linear sRGB -> WCAG contrast. */
function luminance(oklch: string): number {
  const [L, C, H] = oklch.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/)!.slice(1).map(Number) as [number, number, number];
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const R = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const G = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const B = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
const contrast = (x: string, y: string) => {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (a + 0.05) / (b + 0.05);
};

describe("3. the 'worse' chip passes AA for 12px text", () => {
  it("RISK_TEXT on RISK_TINT >= 4.5:1, and the chip uses it", () => {
    expect(contrast(RISK, RISK_TINT)).toBeLessThan(4.5); // the old pairing the judge measured
    expect(contrast(RISK_TEXT, RISK_TINT)).toBeGreaterThanOrEqual(4.5);
    const html = renderHtml(buildAuditPack(fake(), {}, NOW).report);
    expect(html).toMatch(/\.tile \.chip\.worse\{background:var\(--risk-tint\);color:var\(--risk-text\)\}/);
    expect(html).toContain(`--risk-text:${RISK_TEXT}`);
  });
});

describe("4. small samples are faded and never headlined", () => {
  it("a failed-item bar under 20 answers has no rate and is muted", () => {
    const small = failedBar({ label: "Guard", failed: 4, answered: 14, failure_rate: 28.6, template: "Walk" });
    expect(small.muted).toBe(true);
    expect(small.note).not.toContain("28.6");
    expect(small.note).toContain("too few to rate");
    const big = failedBar({ label: "Guard", failed: 4, answered: 40, failure_rate: 10, template: "Walk" });
    expect(big.muted).toBe(false);
    expect(big.note).toContain("10% of 40 answers");
  });

  it("a status mix with only small groups headlines none of them", () => {
    const row = (group: string, on: number, late: number, missed: number) => ({ group, group_kind: "site", key: group, due: on + late + missed, on_time: on, late, missed, wont_do: 0, pending: 0, unknown: 0, resolved: on + late + missed, compliance_pct: Math.round((1000 * on) / (on + late + missed)) / 10, late_pct: null, missed_pct: null });
    const mix = statusMix([row("Small", 2, 2, 1), row("Big", 15, 3, 4)], "site")!;
    expect(mix.kind === "stacked" && mix.title).toBe(`Big has the lowest on-time rate of any site with ${MIN_N}+ resolved: 68.2% of 22`);
    expect(mix.kind === "stacked" && mix.rows[0]!.muted).toBe(true);
    const none = statusMix([row("Small", 2, 2, 1)], "site")!;
    expect(none.kind === "stacked" && none.title).toBe(`No site has ${MIN_N} or more resolved occurrences, so none is rated`);
    expect(none.kind === "stacked" && none.title).not.toMatch(/40%/);
  });

  it("the highlight never lands on a muted bar", () => {
    const svg = visualSvg({ kind: "bars", title: "t", valueLabel: "v", rows: [{ label: "A", value: 5, muted: true }, { label: "B", value: 3 }] }, WIDE);
    expect(svg).not.toContain('fill="oklch(0.21 0.012 250)"><title>A');
  });

  it("schedule report headlines no schedule or site below 20 resolved", () => {
    // fixture schedules resolve 12 occurrences each over 12 weeks
    const md = renderMarkdown(buildScheduleCompliance(fake(), {}, NOW).report);
    expect(md).toContain(`No schedule has ${MIN_N} or more resolved occurrences, so none is rated`);
    expect(md).not.toMatch(/is the least reliable schedule/);
  });
});

describe("5. dumbbell value labels sit beside the filled (current) dot", () => {
  it("at phone width a falling row is labelled left of its filled dot", () => {
    const svg = visualSvg({ kind: "dumbbell", title: "t", fromLabel: "previous", toLabel: "this", unit: "%", good: "down", rows: [{ label: "Ridgeway Warehouse", from: 3.7, to: 2.22 }, { label: "Hilltop Plant", from: 5.2, to: 0.96 }, { label: "Eastgate Yard", from: 7.6, to: 9.52 }] }, NARROW);
    for (const v of ["2.22%", "0.96%"]) {
      const t = svg.match(new RegExp(`<text x="([\\d.]+)"[^>]*text-anchor="end"[^>]*>${v.replace(".", "\\.")}<`));
      expect(t, v).not.toBeNull();
    }
    expect(svg).toMatch(/<text x="[\d.]+" y="[\d.]+" font-size="12" fill="[^"]+" font-weight="600">9\.52%</);
  });
});

describe("6. print", () => {
  it("chart text stays at or above 8pt on A4", () => {
    const px8pt = (8 * 96) / 72;
    expect(TICK * (A4_CONTENT_PX / WIDE)).toBeGreaterThanOrEqual(px8pt);
    expect(LABEL * (A4_CONTENT_PX / WIDE)).toBeGreaterThanOrEqual(px8pt);
  });

  it("section heading, intro and first block are kept together; long tables may break", () => {
    const html = renderHtml(buildMonthlyBoardPack(fake(), {}, NOW).report);
    expect(html).toMatch(/<section><div class="lead"><div class="sec-head">/);
    expect(html).toMatch(/@media print\{[^}]*\.lead\{break-inside:avoid\}|\.lead\{break-inside:avoid\}/);
    expect(html).toContain(".table-wrap{break-inside:auto}");
  });
});

describe("7. one human date format; heatmap rows by severity", () => {
  it("no ISO dates in rendered text (HTML or Markdown) of any new report", () => {
    for (const b of [buildMonthlyBoardPack(fake(), {}, NOW), buildActionBacklog(fake(), {}, NOW), buildScheduleCompliance(fake(), {}, NOW), buildInspectionQuality(fake(), {}, NOW), buildAuditPack(fake(), {}, NOW)]) {
      const html = renderHtml(b.report).replace(/href="[^"]*"/g, "");
      expect(html).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
      expect(renderMarkdown(b.report).replace(/\]\([^)]*\)/g, "")).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    }
    expect(humanDates("last month (2026-09-01 to 2026-09-30)")).toBe("last month (1 Sep 2026 to 30 Sep 2026)");
    expect(humanDay("2025-10-23")).toBe("23 Oct 2025");
  });

  it("board pack heatmap rows run from the highest failed-item rate this period", () => {
    const b = buildMonthlyBoardPack(fake(), {}, NOW);
    const heat = blocks(b.report).find((x) => x.kind === "heatmap");
    const table = blocks(b.report).find((x) => x.kind === "table" && x.columns.some((c) => c.label === "Failed-item rate"));
    expect(heat && table).toBeTruthy();
    if (heat?.kind !== "heatmap" || table?.kind !== "table") return;
    const rate = new Map(table.rows.map((r) => [String(r[1]), Number(String(r[4]).replace("%", ""))]));
    const order = heat.rows.map((r) => rate.get(r.label) ?? -1);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });
});

describe("8. as-of labels and Items", () => {
  it("league overdue is 'at period end', actions overdue is 'now'", () => {
    const html = renderHtml(buildMonthlyBoardPack(fake(), {}, NOW).report);
    expect(html).toContain("Overdue at period end");
    expect(html).toContain("Overdue now");
  });

  it("inspection quality counts 'Items', not 'Questions'", () => {
    const md = renderMarkdown(buildInspectionQuality(fake(), {}, NOW).report);
    expect(md).toMatch(/\| Template \| Inspections \| Items \| Cut \| Fix \|/);
    expect(md).not.toMatch(/\| Questions \|/);
  });
});

describe("9. board pack brief and caller-only targets", () => {
  it("opens with what changed / what to watch / what we need, from analytics outputs", () => {
    const b = buildMonthlyBoardPack(fake(), {}, NOW);
    const first = b.report.sections[0]!.blocks[0]!;
    expect(first.kind).toBe("brief");
    if (first.kind !== "brief") return;
    expect(first.items.map((i) => i.label)).toEqual(["What changed", "What to watch", "What we need"]);
    expect(first.items[2]!.text).toContain(`${b.metrics.overdue_actions} overdue actions`);
    expect(renderMarkdown(b.report)).toContain("- **What we need:**");
  });

  it("draws no target when none is supplied", () => {
    for (const b of [buildMonthlyBoardPack(fake(), {}, NOW), buildScheduleCompliance(fake(), {}, NOW)]) {
      const html = renderHtml(b.report);
      expect(html).not.toMatch(/Target \d|Tolerance \d|target:/);
      expect(JSON.stringify(b.report)).not.toMatch(/"target":/);
    }
  });

  it("draws supplied targets and states them", () => {
    const b = buildMonthlyBoardPack(fake(), { on_time_target_pct: 90, failed_rate_tolerance_pct: 5 }, NOW);
    const html = renderHtml(b.report);
    expect(html).toContain("Tolerance 5%");
    expect(html).toContain("target: 90%");
    expect(renderMarkdown(b.report)).toMatch(/\| On time \| [^|]+ \| [^|]+ \| 90% \|/);
    const s = buildScheduleCompliance(fake(), { on_time_target_pct: 85 }, NOW);
    expect(charts(s.report).find((c) => c.yLabel === "On time")!.target).toEqual({ value: 85, label: "Target 85%" });
    expect(renderHtml(s.report)).toContain("Target 85%");
  });
});

// keep FeedName referenced for fixture typing in editors
export type _F = FeedName;
