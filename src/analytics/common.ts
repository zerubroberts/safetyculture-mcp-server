import type { AnalyticResult, CacheReader, FeedName } from "../cache/contract.js";
import type { ToolResult } from "../core/registry.js";
import { inPeriod, type Period } from "../core/time.js";

/**
 * Shared helpers for analytics tools. Rules every analytic follows:
 * - compute only from cached rows; never estimate or extrapolate
 * - state the period, filters, as_of and per-feed coverage
 * - say plainly when a feed is incomplete or empty instead of reporting zeros as facts
 */

export function coverage(cache: CacheReader, feeds: FeedName[]): AnalyticResult["coverage"] {
  return cache.status(feeds).map(({ feed, rows, last_synced_at, complete }) => ({ feed, rows, last_synced_at, complete }));
}

export function coverageCaveats(cov: AnalyticResult["coverage"]): string[] {
  const out: string[] = [];
  for (const c of cov) {
    if (!c.last_synced_at) out.push(`Feed "${c.feed}" has never been synced, so related figures are missing, not zero.`);
    else if (!c.complete) out.push(`Feed "${c.feed}" was only partially synced (row cap reached); totals may be understated.`);
    else if (c.rows === 0) out.push(`Feed "${c.feed}" is empty for this organisation (module unused or no access).`);
  }
  return out;
}

export function buildResult<Row>(args: {
  version: string;
  period?: Period;
  filters: Record<string, unknown>;
  cache: CacheReader;
  feeds: FeedName[];
  metrics: AnalyticResult["metrics"];
  table: Row[];
  method: string;
  caveats?: string[];
  now: Date;
}): AnalyticResult<Row> {
  const cov = coverage(args.cache, args.feeds);
  return {
    metric_version: args.version,
    period: args.period ? { from: args.period.from.toISOString(), to: args.period.to.toISOString(), label: args.period.label } : undefined,
    filters: Object.fromEntries(Object.entries(args.filters).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))),
    as_of: args.now.toISOString(),
    coverage: cov,
    metrics: args.metrics,
    table: args.table,
    method: args.method,
    caveats: [...coverageCaveats(cov), ...(args.caveats ?? [])],
  };
}

/** Wraps an AnalyticResult as a ToolResult. User-typed labels may appear, so it is marked untrusted. */
export function asTool<Row>(summary: string, result: AnalyticResult<Row>, untrusted = true): ToolResult {
  const stale = result.caveats.length ? ` Caveats: ${result.caveats.length}.` : "";
  return { summary: `${summary}${stale}`, data: result, untrusted };
}

export const field = (row: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n];
  return undefined;
};
export const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
export const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined);
export const bool = (v: unknown) => v === true || v === "true" || v === 1 || v === "1";

export function matchesAny(value: unknown, allowed?: string[]): boolean {
  if (!allowed?.length) return true;
  return value !== undefined && allowed.includes(String(value));
}

export const within = (value: unknown, p: Period) => inPeriod(str(value), p);

/** id -> name lookup for sites, templates and users from the cache. */
export function nameMaps(cache: CacheReader) {
  const sites = new Map<string, string>();
  for (const s of cache.rows("sites")) sites.set(String(s.id), String(s.name ?? s.id));
  const templates = new Map<string, string>();
  for (const t of cache.rows("templates")) templates.set(String(t.id), String(t.name ?? t.id));
  const users = new Map<string, string>();
  for (const u of cache.rows("users")) users.set(String(u.id), [u.firstname, u.lastname].filter(Boolean).join(" ") || String(u.id));
  return { sites, templates, users };
}

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}
