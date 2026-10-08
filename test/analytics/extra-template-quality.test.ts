import { describe, expect, it } from "vitest";
import { computeTemplateQuality } from "../../src/analytics/template-quality.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";
import { NOW, insp, item } from "../reports/fixtures.js";

const PERIOD = parsePeriod("last 6 months", NOW);

/**
 * Template t1, 200 completed inspections in the period:
 *  Q1 "Guard in place?"   question, "Yes" x200                        -> cut (never failed)
 *  Q2 "Notes"             text, "abcd" x50, blank x150                -> fix (skip 75%)
 *  Q3 "Spill kit stocked?" question, "No"(failed) x100, "Yes" x100    -> keep (fail 50%)
 *  Q4 "Ladder tag"        list, "N/A" x120, "Pass" x79, "Fail" x1     -> fix (N/A 60%)
 *  SF smart field + child Q5 "Why?" always blank                       -> skip not determinable, keep
 *  "Comments" twice in inspection 0 only (distinct item ids)           -> 1 duplicate label
 * Durations 600s except inspection 0 with no duration. Plus noise: another template, one out of period.
 */
function cache() {
  const inspections: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < 200; i++) {
    const id = `audit_q${i}`;
    inspections.push(insp(id, { tpl: "template_t1", tplName: "Forklift pre-start", completed: "2026-09-15T10:00:00.000Z", duration: i === 0 ? 0 : 600 }));
    items.push(item(id, "Guard in place?", { response: "Yes" }));
    items.push(item(id, "Notes", { type: "text", response: i < 50 ? "abcd" : "" }));
    items.push(item(id, "Spill kit stocked?", { response: i < 100 ? "No" : "Yes", failed: i < 100 }));
    items.push(item(id, "Ladder tag", { type: "list", response: i < 120 ? "N/A" : i < 199 ? "Pass" : "Fail", failed: i === 199 }));
    items.push(item(id, "Logic", { type: "smartfield", itemId: "sf-1", response: "" }));
    items.push(item(id, "Why?", { parent: "sf-1", itemId: "why-1", response: "" }));
    if (i === 0) {
      items.push(item(id, "Comments", { type: "text", itemId: "c-1", response: "x" }));
      items.push(item(id, " comments ", { type: "text", itemId: "c-2", response: "" }));
    }
  }
  inspections.push(insp("audit_other", { tpl: "template_t2", completed: "2026-09-15T10:00:00.000Z", duration: 5 }));
  items.push(item("audit_other", "Guard in place?", { response: "No", failed: true, tpl: "template_t2" }));
  inspections.push(insp("audit_old", { tpl: "template_t1", completed: "2025-01-15T10:00:00.000Z", duration: 5 }));
  items.push(item("audit_old", "Guard in place?", { response: "No", failed: true }));
  return new FakeCache().seed("inspections", inspections).seed("inspection_items", items).seed("templates", [{ id: "template_t1", name: "Forklift pre-start" }]);
}

describe("computeTemplateQuality", () => {
  const { result, summary } = computeTemplateQuality(cache(), { template_id: "template_t1", period: PERIOD }, NOW);
  const row = (label: string) => result.table.find((r) => r.label === label)!;

  it("counts per item and buckets with evidence", () => {
    expect(row("Guard in place?")).toMatchObject({ times_answered: 200, failed: 0, fail_rate: 0, bucket: "cut candidate", evidence: "answered 200 times and never failed" });
    expect(row("Notes")).toMatchObject({ type: "text", times_presented: 200, times_answered: 50, blank: 150, skip_rate: 75, avg_text_length: 4, bucket: "fix" });
    expect(row("Spill kit stocked?")).toMatchObject({ failed: 100, fail_rate: 50, bucket: "keep" });
    expect(row("Ladder tag")).toMatchObject({ na: 120, na_rate: 60, failed: 1, bucket: "fix", evidence: "answered N/A 120 of 200 times (60%)" });
  });

  it("does not count blanks behind conditional logic as skips", () => {
    expect(row("Why?")).toMatchObject({ times_presented: 200, times_answered: 0, blank: null, skip_rate: null, bucket: "keep" });
    expect(result.table.find((r) => r.label === "Logic")).toBeUndefined(); // smart field container is structural
  });

  it("finds duplicate labels and the median duration", () => {
    expect(result.metrics.inspections).toBe(200);
    expect(result.metrics.median_duration_seconds).toBe(600);
    expect(result.metrics.duplicate_labels).toBe(1);
    expect((result as unknown as { duplicates: unknown[] }).duplicates).toEqual([{ label: "Comments", max_copies: 2, inspections: 1 }]);
    expect(result.caveats.some((c) => c.startsWith("1 inspections have no recorded duration"))).toBe(true);
  });

  it("sorts cut, fix, keep and summarises", () => {
    expect(result.table[0]!.bucket).toBe("cut candidate");
    expect(result.metrics).toMatchObject({ cut_candidates: 1, fix: 2, keep: 3 });
    expect(summary).toContain('"Forklift pre-start"');
  });

  it("always-N/A items are cut candidates from 10 answers, not below", () => {
    const mk = (n: number) => {
      const ins: Record<string, unknown>[] = [];
      const its: Record<string, unknown>[] = [];
      for (let i = 0; i < n; i++) {
        ins.push(insp(`audit_n${i}`, { tpl: "template_t3", completed: "2026-09-15T10:00:00.000Z" }));
        its.push(item(`audit_n${i}`, "Hazmat stored?", { response: i % 2 ? "not applicable" : "N/A" }));
      }
      return new FakeCache().seed("inspections", ins).seed("inspection_items", its);
    };
    const ten = computeTemplateQuality(mk(10), { template_id: "template_t3", period: PERIOD }, NOW).result.table[0]!;
    expect(ten).toMatchObject({ na: 10, na_rate: 100, bucket: "cut candidate", evidence: "answered N/A all 10 times" });
    const nine = computeTemplateQuality(mk(9), { template_id: "template_t3", period: PERIOD }, NOW).result.table[0]!;
    expect(nine.bucket).toBe("keep");
  });
});
