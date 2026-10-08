import type { CacheProvider, ToolContext } from "../core/registry.js";
import { ToolError } from "../core/errors.js";
import type { CacheWriter, FeedName } from "./contract.js";
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
      if (stale.length) await syncAll(ctx.client, store, stale, { now: ctx.now });
      return store;
    },
  };
}

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
