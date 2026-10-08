import { describe, expect, it } from "vitest";
import { buildAuditPack, buildSafetyPulse, buildSiteScorecard } from "../../src/reports/build.js";
import { chartSvg, renderHtml } from "../../src/reports/html.js";
import { renderMarkdown } from "../../src/reports/markdown.js";
import { fmtInstant, type Chart, type Report } from "../../src/reports/model.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, action, insp, issue, item, site } from "./fixtures.js";

/** Synthetic cache: inspections spread over several weeks so weekly buckets hit the period edges. */
function cache() {
  const ins: Record<string, unknown>[] = [];
  const its: Record<string, unknown>[] = [];
  const days = ["2026-08-03T09:00:00.000Z", "2026-08-17T09:00:00.000Z", "2026-09-07T09:00:00.000Z", "2026-09-28T09:00:00.000Z", "2026-10-02T09:00:00.000Z", "2026-10-07T09:00:00.000Z"];
  days.forEach((completed, k) => {
    const id = `restyle_${k}`;
    ins.push(insp(id, { tpl: "template_t1", site: "site-1", completed, score: 90, duration: 600 }));
    its.push(item(id, "Q1"), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
  });
  return new FakeCache()
    .seed("inspections", ins)
    .seed("inspection_items", its)
    .seed("sites", [site("site-1", "Depot")])
    .seed("templates", [{ id: "template_t1", name: "Pre-start", organisation_id: "role_demo-org-0001" }])
    .seed("users", [])
    .seed("actions", [action("a-1", { title: "Fix guard", priority: "HIGH", created: "2026-09-01T00:00:00Z", due: "2026-09-20T00:00:00Z" })])
    .seed("issues", [issue("i-1", { category: "Slips", created: "2026-10-03T00:00:00Z", priority: "High", title: "Wet floor" })])
    .seed("schedule_occurrences", []);
}

const allHtml = () =>
  [
    buildSafetyPulse(cache(), { period: "last 7 days" }, NOW),
    buildAuditPack(cache(), { period: "last 12 months" }, NOW),
    buildSiteScorecard(cache(), { site_id: "site-1", period: "last 6 months" }, NOW),
  ].map((b) => renderHtml(b.report));

describe("brand restyle (DESIGN.md palette)", () => {
  it("uses the graphite / hi-vis / risk tokens and no indigo or purple", () => {
    for (const html of allHtml()) {
      expect(html).toContain("oklch(0.21 0.012 250)");
      expect(html).toContain("oklch(0.43 0.01 250)");
      expect(html).toContain("oklch(0.91 0.2 122)");
      expect(html).toContain("oklch(0.55 0.15 128)");
      expect(html).toContain("oklch(0.58 0.19 27)");
      // No indigo/purple hexes (tailwind indigo/violet ramp as the representative set).
      expect(html).not.toMatch(/#(?:4f46e5|4338ca|3730a3|6366f1|818cf8|a5b4fc|c7d2fe|e0e7ff|6d28d9|5b21b6|7c3aed|8b5cf6|a78bfa|c4b5fd|d8b4fe|ede9fe|4c1d95|5e35b1|673ab7|9c27b0)\b/i);
      // No oklch colour with a hue in the indigo/purple band 260-300.
      expect(html).not.toMatch(/oklch\(\s*[\d.]+\s+[\d.]+\s+(26\d|27\d|28\d|29\d|300)\b/);
      expect(html).not.toContain("4f46e5");
    }
  });

  it("keeps delta words so colour is never the only signal", () => {
    // Deltas only judge with >= 20 observations in both periods: 25 scored 90 this week, 20 scored 100 last week.
    const ins: Record<string, unknown>[] = [];
    const its: Record<string, unknown>[] = [];
    for (let k = 0; k < 25; k++) {
      const id = `delta_w${k}`;
      ins.push(insp(id, { tpl: "template_t1", site: "site-1", completed: `2026-10-0${2 + (k % 6)}T09:00:00.000Z`, score: 90, duration: 600 }));
      its.push(item(id, "Q1"), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
    }
    for (let k = 0; k < 20; k++) {
      const id = `delta_p${k}`;
      ins.push(insp(id, { tpl: "template_t1", site: "site-1", completed: `2026-09-2${5 + (k % 5)}T09:00:00.000Z`, score: 100, duration: 600 }));
      its.push(item(id, "Q1"), item(id, "Q2"), item(id, "Q3"), item(id, "Q4"));
    }
    const dense = new FakeCache()
      .seed("inspections", ins)
      .seed("inspection_items", its)
      .seed("sites", [site("site-1", "Depot")])
      .seed("templates", [{ id: "template_t1", name: "Pre-start", organisation_id: "role_demo-org-0001" }])
      .seed("users", [])
      .seed("actions", [])
      .seed("issues", [])
      .seed("schedule_occurrences", []);
    const html = renderHtml(buildSafetyPulse(dense, { period: "last 7 days" }, NOW).report);
    expect(html).toContain("(better)");
    expect(html).toContain("(worse)");
  });

  it("makes no network requests (system stack, inline CSS/SVG only)", () => {
    for (const html of allHtml()) {
      expect(html).not.toMatch(/<link|<img|<iframe|@import|url\(|src=/i);
      expect(html).toContain("font-family:-apple-system");
    }
  });
});

describe("caveats and methods print once", () => {
  it("safety pulse prints the shared reporting caveat exactly once", () => {
    const { report } = buildSafetyPulse(cache(), { period: "last 7 days" }, NOW);
    const notes = report.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "notes" ? b.items : [])));
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes).size).toBe(notes.length);
    const hits = JSON.stringify(report).split("Lower issue counts can mean less reporting, not fewer hazards.").length - 1;
    expect(hits).toBe(1);
  });

  it("audit pack and scorecard notes are unique too", () => {
    for (const built of [buildAuditPack(cache(), { period: "last 12 months" }, NOW), buildSiteScorecard(cache(), { site_id: "site-1", period: "last 6 months" }, NOW)]) {
      const notes = built.report.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "notes" ? b.items : [])));
      expect(new Set(notes).size).toBe(notes.length);
    }
  });
});

describe("human timestamps", () => {
  it("formats the brief example exactly", () => {
    expect(fmtInstant(new Date("2026-10-08T03:00:00.000Z"))).toBe("8 Oct 2026, 03:00 UTC");
    expect(fmtInstant("not-a-date")).toBe("not-a-date");
  });

  it("header and coverage table carry formatted times, not raw ISO", () => {
    const { report } = buildSafetyPulse(cache(), { period: "last 7 days" }, NOW);
    expect(report.generatedAt).toBe("8 Oct 2026, 12:00 UTC");
    const html = renderHtml(report);
    expect(html).toContain("8 Oct 2026, 12:00 UTC");
    expect(html).toContain("8 Oct 2026, 00:00 UTC");
    expect(html).not.toContain("2026-10-08T00:00:00");
    expect(html).not.toContain("2026-10-08T12:00:00");
    const md = renderMarkdown(report);
    expect(md).toContain("8 Oct 2026, 12:00 UTC");
    expect(md).toContain("8 Oct 2026, 00:00 UTC");
  });
});

describe("partial weeks on the weekly bar chart", () => {
  const weekly = (points: Chart["points"]): Chart => ({ kind: "bar", title: "t", xLabel: "Week starting", yLabel: "Inspections", points });

  it("marks partial bars lighter and footnotes them", () => {
    const svg = chartSvg(weekly([{ label: "2026-09-28", value: 4, partial: true }, { label: "2026-10-05", value: 9 }]));
    expect(svg).toContain('opacity="0.32"');
    expect(svg).toContain("\u2020");
    const report: Report = { title: "T", fingerprint: "f", periodLabel: "p", generatedAt: "g", sections: [{ title: "S", blocks: [{ kind: "chart", chart: weekly([{ label: "a", value: 1, partial: true }, { label: "b", value: 2 }]) }] }] };
    const html = renderHtml(report);
    expect(html).toContain("partial week");
    expect(renderMarkdown(report)).toContain("partial week");
  });

  it("stays silent when every bucket is full", () => {
    const report: Report = { title: "T", fingerprint: "f", periodLabel: "p", generatedAt: "g", sections: [{ title: "S", blocks: [{ kind: "chart", chart: weekly([{ label: "a", value: 1 }, { label: "b", value: 2 }]) }] }] };
    expect(renderHtml(report)).not.toContain("partial week");
    expect(chartSvg(weekly([{ label: "a", value: 1 }]))).not.toContain('opacity="0.32"');
  });

  it("safety pulse weekly chart carries the footnote at the period edge", () => {
    const html = renderHtml(buildSafetyPulse(cache(), { period: "last 7 days" }, NOW).report);
    expect(html).toContain("partial week");
  });
});

describe("print and mobile rules", () => {
  it("keeps A4, avoid-breaks and inner-scrolling tables", () => {
    const html = renderHtml(buildSafetyPulse(cache(), { period: "last 7 days" }, NOW).report);
    expect(html).toContain("@page{size:A4");
    expect(html).toMatch(/section\{[^}]*break-inside:\s*avoid/);
    expect(html).toMatch(/tr\{[^}]*break-inside:\s*avoid/);
    expect(html).toContain("table-wrap");
    expect(html).toMatch(/\.table-wrap\{[^}]*overflow-x:\s*auto/);
    expect(html).toContain("@media print");
    expect(html).toContain("@media (max-width:480px)");
    expect(html).toContain("tabular-nums");
  });
});
