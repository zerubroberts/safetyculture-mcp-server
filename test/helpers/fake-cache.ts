import type { CacheReader, FeedName, FeedStatus } from "../../src/cache/contract.js";

/** In-memory CacheReader for analytics tests. Seed with synthetic rows only. */
export class FakeCache implements CacheReader {
  private data = new Map<FeedName, Record<string, unknown>[]>();
  private synced = new Map<FeedName, { complete: boolean; at: string }>();

  seed(feed: FeedName, rows: Record<string, unknown>[], opts: { complete?: boolean; at?: string } = {}): this {
    this.data.set(feed, rows);
    this.synced.set(feed, { complete: opts.complete ?? true, at: opts.at ?? "2026-10-08T00:00:00.000Z" });
    return this;
  }

  rows<T = Record<string, unknown>>(feed: FeedName, filter?: (row: T) => boolean): T[] {
    const rows = (this.data.get(feed) ?? []) as T[];
    return filter ? rows.filter(filter) : rows;
  }

  status(feeds?: FeedName[]): FeedStatus[] {
    const names = feeds ?? ([...this.data.keys()] as FeedName[]);
    return names.map((feed) => ({
      feed,
      rows: this.data.get(feed)?.length ?? 0,
      last_synced_at: this.synced.get(feed)?.at ?? null,
      watermark: null,
      complete: this.synced.get(feed)?.complete ?? false,
      last_error: null,
    }));
  }
}
