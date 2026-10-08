/** Small, dependency-free statistics used by the analytics tools. Every function is unit-tested. */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

/** Linear-interpolated quantile (type 7, same as Excel PERCENTILE.INC and R's default). */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
export const median = (xs: number[]) => quantile(xs, 0.5);

/** Standard normal CDF (Abramowitz-Stegun 7.1.26, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Wilson score interval for a proportion (95% by default). */
export function wilson(successes: number, n: number, z = 1.959964): { p: number; low: number; high: number } {
  if (n === 0) return { p: NaN, low: NaN, high: NaN };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface TestResult {
  test: string;
  statistic: number;
  p_value: number;
  effect_size: number;
  effect_label: "negligible" | "small" | "medium" | "large";
  verdict: "real difference" | "probably noise" | "not enough data";
}

const verdictOf = (p: number, enough: boolean): TestResult["verdict"] => (!enough ? "not enough data" : p < 0.05 ? "real difference" : "probably noise");

/** Two-proportion z-test (pooled) with Cohen's h effect size. Needs >= 5 expected successes and failures per group. */
export function twoProportionTest(x1: number, n1: number, x2: number, n2: number): TestResult {
  const p1 = n1 ? x1 / n1 : 0;
  const p2 = n2 ? x2 / n2 : 0;
  const pooled = n1 + n2 ? (x1 + x2) / (n1 + n2) : 0;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / (n1 || 1) + 1 / (n2 || 1)));
  const z = se > 0 ? (p1 - p2) / se : 0;
  const p = se > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
  const h = 2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p2));
  const enough = Math.min(n1 * pooled, n1 * (1 - pooled), n2 * pooled, n2 * (1 - pooled)) >= 5;
  const a = Math.abs(h);
  return {
    test: "two-proportion z-test",
    statistic: z,
    p_value: p,
    effect_size: h,
    effect_label: a < 0.2 ? "negligible" : a < 0.5 ? "small" : a < 0.8 ? "medium" : "large",
    verdict: verdictOf(p, enough),
  };
}

/** Mann-Whitney U test (normal approximation with tie correction) and rank-biserial effect size. */
export function mannWhitney(a: number[], b: number[]): TestResult {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { test: "Mann-Whitney U", statistic: NaN, p_value: 1, effect_size: 0, effect_label: "negligible", verdict: "not enough data" };
  const all = [...a.map((v) => ({ v, g: 0 })), ...b.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(all.length);
  let tieTerm = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.v === all[i]!.v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    const t = j - i + 1;
    tieTerm += t * t * t - t;
    i = j + 1;
  }
  const r1 = sum(all.map((x, i) => (x.g === 0 ? ranks[i]! : 0)));
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const n = n1 + n2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  const z = sigma > 0 ? (u1 - (n1 * n2) / 2) / sigma : 0;
  const p = sigma > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
  const rbc = 1 - (2 * Math.min(u1, n1 * n2 - u1)) / (n1 * n2);
  const signed = u1 > (n1 * n2) / 2 ? rbc : -rbc;
  const e = Math.abs(signed);
  return {
    test: "Mann-Whitney U",
    statistic: u1,
    p_value: p,
    effect_size: signed,
    effect_label: e < 0.1 ? "negligible" : e < 0.3 ? "small" : e < 0.5 ? "medium" : "large",
    verdict: verdictOf(p, n1 >= 8 && n2 >= 8),
  };
}

export const round = (x: number, dp = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : null);
export const pct = (num: number, den: number, dp = 1) => (den > 0 ? round((100 * num) / den, dp) : null);
