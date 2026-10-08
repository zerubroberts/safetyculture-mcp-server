import { describe, expect, it } from "vitest";
import { mannWhitney, median, normCdf, quantile, twoProportionTest, wilson } from "../../src/analytics/stats.js";

// Reference values computed independently (textbook formulas / R).
describe("stats", () => {
  it("normal CDF", () => {
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 4);
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(-1)).toBeCloseTo(0.158655, 5);
  });

  it("quantiles match type-7 interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 10);
    expect(median([5])).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it("Wilson interval for 8/10", () => {
    const w = wilson(8, 10);
    expect(w.low).toBeCloseTo(0.4902, 3);
    expect(w.high).toBeCloseTo(0.9433, 3);
  });

  it("two-proportion z-test 45/100 vs 30/100", () => {
    const r = twoProportionTest(45, 100, 30, 100);
    expect(r.statistic).toBeCloseTo(2.1909, 3);
    expect(r.p_value).toBeCloseTo(0.0285, 3);
    expect(r.verdict).toBe("real difference");
  });

  it("two-proportion test refuses tiny samples", () => {
    expect(twoProportionTest(1, 3, 0, 4).verdict).toBe("not enough data");
  });

  it("Mann-Whitney on fully separated groups", () => {
    const r = mannWhitney([1, 2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15, 16]);
    expect(r.statistic).toBe(0);
    expect(r.p_value).toBeLessThan(0.001);
    expect(r.effect_size).toBeCloseTo(-1, 6);
    expect(r.verdict).toBe("real difference");
  });

  it("Mann-Whitney on identical groups is noise", () => {
    const a = [3, 5, 7, 9, 11, 13, 15, 17];
    expect(mannWhitney(a, [...a]).verdict).toBe("probably noise");
  });
});
