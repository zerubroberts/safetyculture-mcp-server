import type { CacheProvider, ToolContext } from "../core/registry.js";
import { ToolError } from "../core/errors.js";
import type { CacheReader, CacheWriter, FeedName } from "./contract.js";
import { cacheFilePath, SqliteCache } from "./store.js";
import { syncAll, type FeedSyncReport, type SyncOptions } from "./sync.js";

export { FEEDS, FEED_NAMES, DEFAULT_SYNC_FEEDS } from "./feeds.js";
export { SqliteCache } from "./store.js";

type Ctx = Omit<ToolContext, "cache">;

/**
 * The organisation's local analytics cache. Opening is lazy: the first call asks WhoAmI for the
 * organisation ID (to pick the cache file) and opens SQLite; later calls reuse the connection.
 */
export function createCacheProvider(ctx: Ctx): CacheProvider {
  let opening: Promise<SqliteCache> | undefined;

  const open = (): Promise<SqliteCache> => {
    opening ??= (async () => {
      const me = await ctx.client.get<{ organisation_id?: string }>("/accounts/user/v1/user:WhoAmI");
      if (!me.organisation_id) throw new ToolError("Could not determine the organisation for this API token (WhoAmI returned no organisation_id).");
      return new SqliteCache(cacheFilePath(ctx.config.dataDir, me.organisation_id));
    })().catch((err) => {
      opening = undefined;
      throw err;
    });
    return opening;
  };

  // One in-flight sync per feed, shared by every caller, so a slow first sync started by one
  // tool call keeps running in the background and later calls simply wait for it again.
  const inFlight = new Map<FeedName, Promise<unknown>>();
  const budgetMs = Number(process.env.SC_SYNC_BUDGET_MS ?? 40_000);

  return {
    open,
    async ensure(feeds, opts = {}) {
      const store = await open();
      const maxAgeMs = (opts.maxAgeMinutes ?? 60) * 60_000;
      const now = ctx.now().getTime();
      const stale = store
        .details(feeds)
        .filter((s) => !s.last_synced_at || now - Date.parse(s.last_synced_at) > maxAgeMs)
        .map((s) => s.feed);
      const running = stale.map((feed) => {
        let p = inFlight.get(feed);
        if (!p) {
          p = syncAll(ctx.client, store, [feed], { now: ctx.now }).finally(() => inFlight.delete(feed));
          p.catch(() => undefined);
          inFlight.set(feed, p);
        }
        return p;
      });
      if (!running.length) return store;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = await Promise.race([
        Promise.allSettled(running).then(() => false),
        new Promise<boolean>((r) => (timer = setTimeout(() => r(true), budgetMs))),
      ]);
      clearTimeout(timer);
      if (!timedOut) return store;
      return withSyncingNote(store, () => new Set(inFlight.keys()));
    },
  };
}

/** Marks feeds whose first sync is still running, so analytics say "partial, still syncing". */
function withSyncingNote(store: SqliteCache, syncing: () => Set<FeedName>): CacheReader {
  return {
    rows: (feed, filter) => store.rows(feed, filter),
    status: (feeds) =>
      store.status(feeds).map((s) => (syncing().has(s.feed) ? { ...s, complete: false, last_error: SYNCING_NOTE } : s)),
  };
}

export const SYNCING_NOTE = "SYNCING: still downloading in the background";

/** Syncs feeds into the organisation's cache (used by sc_sync). Returns one report per feed. */
export async function syncFeeds(ctx: ToolContext, feeds: FeedName[], opts: Omit<SyncOptions, "now"> = {}): Promise<{ store: SqliteCache; reports: FeedSyncReport[] }> {
  const store = asSqlite(await ctx.cache.open());
  const reports = await syncAll(ctx.client, store, feeds, { ...opts, now: ctx.now });
  return { store, reports };
}

/** The tools need the SQLite-specific extras (file path, details, size). */
export function asSqlite(cache: CacheWriter): SqliteCache {
  if (!(cache instanceof SqliteCache)) throw new ToolError("This tool needs the SQLite cache, which is not active in this server.");
  return cache;
}
