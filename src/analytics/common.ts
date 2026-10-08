import type { AnalyticResult, CacheReader, FeedName } from "../cache/contract.js";
import type { ToolResult } from "../core/registry.js";
import { inPeriod, type Period } from "../core/time.js";

/**
 * Shared helpers for analytics tools. Rules every analytic follows:
 * - compute only from cached rows; never estimate or extrapolate
 * - state the period, filters, as_of and per-feed coverage
 * - say plainly when a feed is incomplete or empty instead of reporting zeros as facts
 */

/** Feeds older than this are stale: it matches the re-sync age CacheProvider.ensure uses by default. */
export const FRESHNESS_MINUTES = 60;

/**
 * Per-feed coverage. A feed whose latest refresh failed, or that the API now refuses, is never
 * reported complete even if an earlier snapshot was. Pass `now` to include the cache age.
 */
export function coverage(cache: CacheReader, feeds: FeedName[], now?: Date): AnalyticResult["coverage"] {
  return cache.status(feeds).map(({ feed, rows, last_synced_at, complete, last_error, unavailable }) => {
    const syncing = Boolean(last_error?.startsWith("SYNCING"));
    const failed = !syncing && last_error ? last_error.slice(0, 400) : undefined;
    const age = now && last_synced_at ? Math.floor((now.getTime() - Date.parse(last_synced_at)) / 60_000) : NaN;
    return {
      feed,
      rows,
      last_synced_at,
      complete: complete && !failed,
      ...(syncing ? { note: "still syncing" } : {}),
      ...(unavailable ? { unavailable } : {}),
      ...(failed ? { last_error: failed } : {}),
      ...(Number.isFinite(age) ? { age_minutes: Math.max(0, age) } : {}),
    };
  });
}

/**
 * Why a feed's cached rows cannot back a figure, or null when they can. Unusable: never synced, refused by
 * the API (unavailable), still downloading for the first time, or a failed refresh with no complete snapshot
 * to fall back on. A feed that synced successfully and is empty IS usable: its zero is a true zero (and gets
 * the "empty feed" caveat). A failed refresh over a complete earlier snapshot stays usable with a stale caveat.
 * Figures derived from an unusable feed must be null, never 0.
 */
export function feedProblem(cache: CacheReader, feed: FeedName): string | null {
  const s = cache.status([feed]).find((x) => x.feed === feed);
  if (!s) return `the ${feed} feed has never been synced`;
  if (s.unavailable) return `the ${feed} feed could not be read (${s.unavailable.slice(0, 200)})`;
  if (s.last_error?.startsWith("SYNCING")) return `the ${feed} feed is still downloading for the first time`;
  if (s.last_error && !s.complete) return `the ${feed} feed could not be read (${s.last_error.slice(0, 200)})`;
  if (!s.last_synced_at) return `the ${feed} feed has never been synced`;
  return null;
}

export const feedUsable = (cache: CacheReader, feed: FeedName): boolean => feedProblem(cache, feed) === null;

/** Summary sentence for figures withheld because a feed is unusable, e.g. "Action figures unavailable: the actions feed could not be read (HTTP 403)." */
export const unavailableSentence = (what: string, problem: string) => `${what} unavailable: ${problem.replace(/\.$/, "")}.`;

const ageText = (min: number) => (min < 120 ? `${min} minutes` : min < 48 * 60 ? `${Math.round(min / 60)} hours` : `${Math.round(min / 1440)} days`);

export function coverageCaveats(cov: AnalyticResult["coverage"]): string[] {
  const out: string[] = [];
  for (const c of cov) {
    const age = c.age_minutes !== undefined ? ` (${ageText(c.age_minutes)} ago)` : "";
    if (c.note === "still syncing")
      out.push(`Feed "${c.feed}" is still downloading for the first time (the Mitti API serves it slowly); figures that depend on it are withheld or partial until it finishes. Ask again in a minute or two for complete numbers.`);
    else if (c.unavailable && c.rows > 0)
      out.push(`Feed "${c.feed}" is no longer accessible to this API token (${c.unavailable}); its ${c.rows} cached rows from ${c.last_synced_at ?? "an earlier sync"}${age} are not current, so related figures may be out of date.`);
    else if (c.unavailable) out.push(`Feed "${c.feed}" is unavailable to this API token (${c.unavailable}), so related figures are missing, not zero.`);
    else if (!c.last_synced_at) out.push(`Feed "${c.feed}" has never been synced, so related figures are missing, not zero.`);
    else if (c.last_error)
      out.push(`The latest refresh of feed "${c.feed}" failed (${c.last_error}); figures use rows cached at ${c.last_synced_at}${age} and may be out of date or partial.`);
    else if (!c.complete) out.push(`Feed "${c.feed}" was only partially synced (row cap reached); totals may be understated.`);
    else if (c.rows === 0) out.push(`Feed "${c.feed}" is empty for this organisation (module unused or no access).`);
    if (!c.note && !c.unavailable && !c.last_error && c.age_minutes !== undefined && c.age_minutes > FRESHNESS_MINUTES)
      out.push(`Feed "${c.feed}" was last synced ${ageText(c.age_minutes)} ago, older than its ${FRESHNESS_MINUTES}-minute freshness window; recent changes may be missing.`);
  }
  return out;
}

/** Default row cap for analytics tables that can grow with the organisation (people, credentials, flags). */
export const DEFAULT_TABLE_LIMIT = 50;

/**
 * The first `limit` rows of an already-ranked list, plus the full count. Headline metrics must be
 * computed on the full list before calling this; only the returned detail rows are cut.
 */
export function bounded<T>(rows: T[], limit: number = DEFAULT_TABLE_LIMIT): { rows: T[]; total: number; truncated: boolean } {
  const n = Math.max(1, Math.floor(limit));
  return { rows: rows.slice(0, n), total: rows.length, truncated: rows.length > n };
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
  const cov = coverage(args.cache, args.feeds, args.now);
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
