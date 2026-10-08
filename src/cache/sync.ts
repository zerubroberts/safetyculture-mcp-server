import type { Query, ScClient } from "../core/client.js";
import { ScApiError } from "../core/errors.js";
import type { FeedDef, FeedName, SyncReport } from "./contract.js";
import { FEEDS } from "./feeds.js";
import type { SqliteCache } from "./store.js";

export const DEFAULT_MAX_ROWS = 50_000;
/** Incremental pulls re-read this much before the watermark, so rows committed late are not missed. */
export const OVERLAP_MS = 10 * 60_000;
export const FALLBACK_PAGE_SIZE = 100;
// The feeds' default page is 20 rows (data-feeds reference); page budget assumes no fewer per page.
const MIN_EXPECTED_PAGE = 20;

export interface SyncOptions {
  /** Ignore the watermark and re-pull the whole feed. */
  full?: boolean;
  /**
   * Cap per feed (default 50,000). A capped pull is reported as complete: false; a capped full pull
   * never overwrites a previous complete snapshot (it is kept and flagged through last_error).
   */
  maxRows?: number;
  now?: () => Date;
}

export interface FeedSyncReport extends SyncReport {
  /** True when every row the feed offers is in the cache after this run. */
  complete: boolean;
  /** Set when the API refused the feed (module not licensed / no permission). Not an error. */
  unavailable?: string;
  page_size: number;
  /** The modified_after / triggered_after value sent, for incremental runs. */
  since?: string;
}

// One in-flight sync per (cache file, feed): concurrent analytics calls share it instead of
// pulling the same feed twice.
const inflight = new WeakMap<SqliteCache, Map<FeedName, Promise<FeedSyncReport>>>();

export function syncFeed(client: ScClient, store: SqliteCache, feed: FeedName, opts: SyncOptions = {}): Promise<FeedSyncReport> {
  let perStore = inflight.get(store);
  if (!perStore) inflight.set(store, (perStore = new Map()));
  const running = perStore.get(feed);
  if (running) return running;
  const p = runSync(client, store, FEEDS[feed], opts).finally(() => perStore.delete(feed));
  perStore.set(feed, p);
  return p;
}

/** Syncs feeds one after another (the API rate limit is shared anyway). One feed failing never stops the rest. */
export async function syncAll(client: ScClient, store: SqliteCache, feeds: FeedName[], opts: SyncOptions = {}): Promise<FeedSyncReport[]> {
  const out: FeedSyncReport[] = [];
  for (const feed of [...new Set(feeds)]) out.push(await syncFeed(client, store, feed, opts));
  return out;
}

async function runSync(client: ScClient, store: SqliteCache, def: FeedDef, opts: SyncOptions): Promise<FeedSyncReport> {
  const now = opts.now ?? (() => new Date());
  const started = Date.now();
  const maxRows = Math.max(1, opts.maxRows ?? DEFAULT_MAX_ROWS);
  const [prev] = store.details([def.name]);

  // Incremental only from a previous complete pull: resuming after a capped pull would depend on
  // the feed's ordering, which the API does not document.
  const incremental = Boolean(def.incremental && !opts.full && prev?.watermark && prev.complete);
  const since = incremental ? new Date(Date.parse(prev!.watermark!) - OVERLAP_MS).toISOString() : undefined;
  let pageSize = def.pageSize ?? FALLBACK_PAGE_SIZE;

  const report = (r: Partial<FeedSyncReport>): FeedSyncReport => ({
    feed: def.name,
    fetched: 0,
    upserted: 0,
    pages: 0,
    full: !incremental,
    duration_ms: Date.now() - started,
    complete: false,
    page_size: pageSize,
    ...(since ? { since } : {}),
    ...r,
  });

  const pull = (limit: number) => {
    const query: Query = { ...def.query, limit };
    if (since && def.incremental) query[def.incremental] = since;
    return client.collectFeed<Record<string, unknown>>(def.path, query, { maxItems: maxRows, maxPages: Math.ceil(maxRows / MIN_EXPECTED_PAGE) + 10 });
  };

  let result: Awaited<ReturnType<typeof pull>>;
  try {
    try {
      result = await pull(pageSize);
    } catch (err) {
      // Some feeds reject large pages with a 400; retry once with the smallest documented size.
      if (!(err instanceof ScApiError && err.status === 400 && pageSize > FALLBACK_PAGE_SIZE)) throw err;
      pageSize = FALLBACK_PAGE_SIZE;
      result = await pull(pageSize);
    }
  } catch (err) {
    if (err instanceof ScApiError && (err.status === 403 || err.status === 404)) {
      const message = apiMessage(err);
      store.setUnavailable(def.name, message);
      if (!prev?.rows) {
        // Nothing cached: an empty, unavailable feed is the whole truth, so record the attempt.
        store.setState(def.name, { last_synced_at: now().toISOString(), complete: true, last_error: null });
        return report({ complete: true, unavailable: message });
      }
      // Access lost after earlier syncs: the cached rows are no longer current. Keep them (a refusal
      // is not proof they were deleted) but never present them as a fresh, complete snapshot.
      const lastError = `Access refused on refresh: ${message} Kept the ${prev.rows} rows cached at ${prev.last_synced_at ?? "an earlier sync"}; they are no longer current.`;
      store.setState(def.name, { complete: false, last_error: lastError });
      return report({ complete: false, unavailable: message, error: lastError });
    }
    const message = err instanceof Error ? err.message : String(err);
    store.setState(def.name, { last_error: message });
    return report({ error: message, complete: Boolean(prev?.complete) });
  }

  const { items, pages, truncated, stuck } = result;
  const finished = !truncated && !stuck;
  const stuckError = `The feed returned a repeating page cursor after ${pages} pages; sync stopped there.`;

  // A full pull that stopped early (row cap or stuck cursor) must not be mixed into the previous
  // snapshot: upstream deletions would survive next to a partial current set, over- or undercounting.
  // Keep a previous complete snapshot untouched and say so; otherwise the newer partial replaces it.
  if (!incremental && !finished && prev?.complete && prev.rows > 0) {
    const why = stuck ? stuckError : `The full refresh hit the ${maxRows}-row cap.`;
    const lastError = `${why} Kept the previous complete snapshot from ${prev.last_synced_at ?? "an earlier sync"}; rows changed or deleted since then are not reflected.`;
    store.setUnavailable(def.name, null);
    store.setState(def.name, { last_error: lastError });
    return report({ fetched: items.length, upserted: 0, pages, complete: false, error: lastError });
  }

  const watermark = maxTime(items, def.modifiedField, prev?.watermark ?? null);
  const upserted = incremental ? store.upsert(def.name, items) : store.replace(def.name, items);
  const lastError = stuck ? `${stuckError} Cached rows for this feed are partial.` : null;

  store.setUnavailable(def.name, null);
  store.setState(def.name, { last_synced_at: now().toISOString(), watermark, complete: finished, last_error: lastError });
  return report({ fetched: items.length, upserted, pages, complete: finished, ...(lastError ? { error: lastError } : {}) });
}

/** Latest timestamp in `field` across rows, never earlier than `prev`. Returned as ISO 8601. */
export function maxTime(rows: Record<string, unknown>[], field: string | undefined, prev: string | null): string | null {
  let best = prev ? Date.parse(prev) : Number.NEGATIVE_INFINITY;
  if (field) {
    for (const r of rows) {
      const v = r[field];
      if (typeof v !== "string" || !v) continue;
      const t = Date.parse(v);
      if (Number.isFinite(t) && t > best) best = t;
    }
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

/** The API's own explanation from an error body, trimmed; falls back to the status line. */
// Feed status is stored in the cache and quoted in many outputs, at any privacy level, so it never
// carries the API's own reply text (which can quote names): status code and a fixed reason only.
function apiMessage(err: ScApiError): string {
  return `HTTP ${err.status} (module not licensed for this organisation, or the token's user lacks permission)`;
}
