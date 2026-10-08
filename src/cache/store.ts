import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CacheWriter, FeedName, FeedStatus } from "./contract.js";
import { FEED_NAMES, FEEDS } from "./feeds.js";
import { sqlite } from "./sqlite.js";

/** First 16 hex chars of sha256(organisation_id): names the cache file without revealing the org. */
export const orgFingerprint = (organisationId: string) => createHash("sha256").update(organisationId).digest("hex").slice(0, 16);

/**
 * One cache per organisation AND per Mitti user: API tokens carry their user's permissions, so a
 * cache filled by one user's token must never be readable through another user's token.
 */
export const cacheFilePath = (dataDir: string, organisationId: string, userId?: string) =>
  join(dataDir, "cache", `${orgFingerprint(organisationId)}${userId ? `-${orgFingerprint(userId).slice(0, 8)}` : ""}.sqlite`);

export const tableName = (feed: FeedName) => {
  if (!(feed in FEEDS)) throw new Error(`Unknown feed ${feed}`);
  return `feed_${feed}`;
};

export interface FeedDetail extends FeedStatus {
  table: string;
  /** Set when the API refused the feed (403/404: module not licensed or no permission). */
  unavailable: string | null;
}

interface StateRow {
  feed: string;
  last_synced_at: string | null;
  watermark: string | null;
  complete: number;
  last_error: string | null;
  unavailable: string | null;
}

/**
 * The organisation's local cache: one SQLite file, one table per feed storing the raw row as JSON,
 * plus sync_state. All writes are transactional; reads parse rows back into objects.
 */
export class SqliteCache implements CacheWriter {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(readonly path: string) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!existsSync(path)) closeSync(openSync(path, "a", 0o600));
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best effort: some filesystems (and Windows) ignore POSIX modes.
    }
    const { DatabaseSync } = sqlite();
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys = OFF;");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS sync_state (
        feed TEXT PRIMARY KEY,
        last_synced_at TEXT,
        watermark TEXT,
        complete INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        unavailable TEXT
      );`,
    );
    for (const feed of FEED_NAMES) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${tableName(feed)} (id TEXT PRIMARY KEY, modified_at TEXT, data TEXT NOT NULL);`);
    }
  }

  rows<T = Record<string, unknown>>(feed: FeedName, filter?: (row: T) => boolean): T[] {
    const out: T[] = [];
    for (const r of this.db.prepare(`SELECT data FROM ${tableName(feed)} ORDER BY rowid`).all() as Array<{ data: string }>) {
      const row = JSON.parse(r.data) as T;
      if (!filter || filter(row)) out.push(row);
    }
    return out;
  }

  count(feed: FeedName): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${tableName(feed)}`).get() as { n: number }).n);
  }

  status(feeds: FeedName[] = FEED_NAMES): FeedStatus[] {
    return this.details(feeds).map(({ feed, rows, last_synced_at, watermark, complete, last_error, unavailable }) => ({
      feed,
      rows,
      last_synced_at,
      watermark,
      complete,
      last_error,
      ...(unavailable ? { unavailable } : {}),
    }));
  }

  details(feeds: FeedName[] = FEED_NAMES): FeedDetail[] {
    return feeds.map((feed) => {
      const s = this.state(feed);
      return {
        feed,
        table: tableName(feed),
        rows: this.count(feed),
        last_synced_at: s?.last_synced_at ?? null,
        watermark: s?.watermark ?? null,
        complete: Boolean(s?.complete),
        last_error: s?.last_error ?? null,
        unavailable: s?.unavailable ?? null,
      };
    });
  }

  /**
   * Inserts or replaces rows by primary key (idempotent: re-sending a row overwrites it).
   * Rows without a usable key are skipped. Returns the number of rows written.
   */
  upsert(feed: FeedName, rows: Record<string, unknown>[]): number {
    return this.write(feed, rows, false);
  }

  /** Replaces the whole table with `rows` in one transaction (used after a complete full pull). */
  replace(feed: FeedName, rows: Record<string, unknown>[]): number {
    return this.write(feed, rows, true);
  }

  setState(feed: FeedName, patch: Partial<Omit<FeedStatus, "feed" | "rows">>): void {
    this.patchState(feed, patch);
  }

  /** Marks a feed as unavailable (403/404) with the API's message, or clears the flag with null. */
  setUnavailable(feed: FeedName, message: string | null): void {
    this.patchState(feed, { unavailable: message });
  }

  reset(feed?: FeedName): void {
    const feeds = feed ? [feed] : FEED_NAMES;
    this.transaction(() => {
      for (const f of feeds) {
        this.db.exec(`DELETE FROM ${tableName(f)};`);
        this.db.prepare("DELETE FROM sync_state WHERE feed = ?").run(f);
      }
    });
  }

  sizeBytes(): number {
    try {
      return statSync(this.path).size;
    } catch {
      return 0;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private state(feed: FeedName): StateRow | undefined {
    return this.db.prepare("SELECT * FROM sync_state WHERE feed = ?").get(feed) as StateRow | undefined;
  }

  private patchState(feed: FeedName, patch: Partial<Omit<FeedStatus, "feed" | "rows">> & { unavailable?: string | null }): void {
    const cur = this.state(feed);
    const next = {
      last_synced_at: patch.last_synced_at !== undefined ? patch.last_synced_at : (cur?.last_synced_at ?? null),
      watermark: patch.watermark !== undefined ? patch.watermark : (cur?.watermark ?? null),
      complete: patch.complete !== undefined ? (patch.complete ? 1 : 0) : (cur?.complete ?? 0),
      last_error: patch.last_error !== undefined ? patch.last_error : (cur?.last_error ?? null),
      unavailable: patch.unavailable !== undefined ? patch.unavailable : (cur?.unavailable ?? null),
    };
    this.db
      .prepare(
        `INSERT INTO sync_state (feed, last_synced_at, watermark, complete, last_error, unavailable) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(feed) DO UPDATE SET last_synced_at = excluded.last_synced_at, watermark = excluded.watermark,
           complete = excluded.complete, last_error = excluded.last_error, unavailable = excluded.unavailable`,
      )
      .run(feed, next.last_synced_at, next.watermark, next.complete, next.last_error, next.unavailable);
  }

  private write(feed: FeedName, rows: Record<string, unknown>[], replaceAll: boolean): number {
    const def = FEEDS[feed];
    const table = tableName(feed);
    const stmt = this.db.prepare(
      `INSERT INTO ${table} (id, modified_at, data) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET modified_at = excluded.modified_at, data = excluded.data`,
    );
    let written = 0;
    this.transaction(() => {
      if (replaceAll) this.db.exec(`DELETE FROM ${table};`);
      for (const row of rows) {
        const id = def.key(row);
        if (!id) continue;
        const modified = def.modifiedField ? row[def.modifiedField] : undefined;
        stmt.run(id, modified === undefined || modified === null ? null : String(modified), JSON.stringify(row));
        written++;
      }
    });
    return written;
  }

  private transaction(fn: () => void): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      fn();
      this.db.exec("COMMIT;");
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }
}
