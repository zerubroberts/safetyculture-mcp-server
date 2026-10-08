import type { FeedName, FeedStatus } from "../../src/cache/contract.js";
import { FakeCache } from "../helpers/fake-cache.js";

/**
 * Feed sync states shared by the fail-closed tests. They mirror what the sync engine records
 * (src/cache/sync.ts, src/cache/index.ts); the same five states as fail-closed.test.ts.
 */

export const SYNCED = "2026-10-08T11:30:00.000Z";

export type Patch = Partial<Omit<FeedStatus, "feed">>;

/** FakeCache whose sync state can be overridden per feed. */
export class StateCache extends FakeCache {
  private patches = new Map<FeedName, Patch>();
  state(feed: FeedName, patch: Patch): this {
    this.patches.set(feed, patch);
    return this;
  }
  override status(feeds?: FeedName[]): FeedStatus[] {
    return super.status(feeds).map((s) => ({ ...s, ...(this.patches.get(s.feed) ?? {}) }));
  }
}

export interface Unusable {
  name: string;
  /** Whether the cache still holds rows in this state (stale rows kept). */
  keepRows: boolean;
  patch: Patch;
  reason: RegExp;
}

/** The states in which a feed's rows cannot back a figure. */
export const UNUSABLE: Unusable[] = [
  {
    name: "refused on first sync (HTTP 403)",
    keepRows: false,
    patch: { last_synced_at: SYNCED, complete: true, unavailable: "HTTP 403: no permission" },
    reason: /could not be read \(HTTP 403: no permission\)/,
  },
  {
    name: "failed on first sync (HTTP 500)",
    keepRows: false,
    patch: { last_synced_at: null, complete: false, last_error: "Mitti API 500: internal error" },
    reason: /could not be read \(Mitti API 500: internal error\)/,
  },
  {
    name: "access lost after earlier syncs (stale rows kept)",
    keepRows: true,
    patch: { last_synced_at: SYNCED, complete: false, unavailable: "HTTP 403: no permission", last_error: "Access refused on refresh: HTTP 403: no permission" },
    reason: /could not be read \(HTTP 403: no permission\)/,
  },
  {
    name: "still downloading for the first time",
    keepRows: true,
    patch: { last_synced_at: null, complete: false, last_error: "SYNCING: still downloading in the background" },
    reason: /still downloading/,
  },
  { name: "never synced", keepRows: false, patch: { last_synced_at: null, complete: false }, reason: /never been synced/ },
];

/** Seeds `data` into a StateCache, then puts `broken` into state `u` (rows dropped unless the state keeps them). */
export function stateCache(data: Partial<Record<FeedName, Record<string, unknown>[]>>, broken?: FeedName, u?: Unusable): StateCache {
  const c = new StateCache();
  for (const [feed, rows] of Object.entries(data) as Array<[FeedName, Record<string, unknown>[]]>) {
    if (feed === broken && u && !u.keepRows) {
      if (u.name !== "never synced") c.seed(feed, []);
    } else c.seed(feed, rows);
  }
  if (broken && u) c.state(broken, u.patch);
  return c;
}
