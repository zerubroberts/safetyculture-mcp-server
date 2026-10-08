import type { CacheReader, FeedName, FeedStatus } from "../cache/contract.js";
import { bool, str } from "../analytics/common.js";
import { canon, idIn } from "../analytics/failed-items.js";

/**
 * Read-side helpers that make one dashboard build affordable. A dashboard runs the analytics many times
 * (every period preset x every site), and the SQLite reader parses every row from JSON on each call, so:
 *
 * - `memoReader` parses each feed once per build and hands the analytics the same rows every time.
 * - `narrowed` hands an analytic only the rows that can affect its answer for one scope. The analytics
 *   still apply their own filters, so the result is identical; the narrowing only skips rows the
 *   analytic would discard anyway (tests compare against the analytics on the full cache).
 *
 * `status()` always passes through untouched, so coverage, row counts and fail-closed checks
 * (feedProblem) see the real cache state.
 */

class Reader implements CacheReader {
  constructor(
    private readonly base: CacheReader,
    private readonly rowsOf: (feed: FeedName) => Record<string, unknown>[],
  ) {}
  rows<T = Record<string, unknown>>(feed: FeedName, filter?: (row: T) => boolean): T[] {
    const rows = this.rowsOf(feed) as T[];
    return filter ? rows.filter(filter) : rows;
  }
  status(feeds?: FeedName[]): FeedStatus[] {
    return this.base.status(feeds);
  }
}

/**
 * Parses each feed once and reads each feed's sync state once (the SQLite reader runs a count query per
 * status call, and every analytic asks several times). A build is synchronous, so the cache cannot change
 * underneath it. The analytics never mutate rows, so sharing the arrays is safe.
 */
export function memoReader(base: CacheReader): CacheReader {
  const memo = new Map<FeedName, Record<string, unknown>[]>();
  const states = new Map<FeedName, FeedStatus | null>();
  const reader = new Reader(base, (feed) => {
    let rows = memo.get(feed);
    if (!rows) {
      rows = base.rows(feed);
      memo.set(feed, rows);
    }
    return rows;
  });
  reader.status = (feeds?: FeedName[]) => {
    if (!feeds) return base.status();
    const missing = feeds.filter((f) => !states.has(f));
    if (missing.length) {
      const got = base.status(missing);
      for (const f of missing) states.set(f, got.find((s) => s.feed === f) ?? null);
    }
    return feeds.map((f) => states.get(f)).filter((s): s is FeedStatus => Boolean(s));
  };
  return reader;
}

/** A reader whose listed feeds are replaced by the given rows; every other feed and status() pass through. */
export function narrowed(base: CacheReader, replace: Partial<Record<FeedName, Record<string, unknown>[]>>): CacheReader {
  return new Reader(base, (feed) => replace[feed] ?? base.rows(feed));
}

/** Lookups built once per dashboard build and shared by every scope (canon() on every row is the slow part). */
export interface BuildIndex {
  itemsByAudit: Map<string, Record<string, unknown>[]>;
  inspectionById: Map<string, Record<string, unknown>>;
}

export function buildIndex(base: CacheReader): BuildIndex {
  const itemsByAudit = new Map<string, Record<string, unknown>[]>();
  for (const it of base.rows("inspection_items")) {
    const k = canon(it.audit_id);
    const list = itemsByAudit.get(k);
    if (list) list.push(it);
    else itemsByAudit.set(k, [it]);
  }
  const inspectionById = new Map<string, Record<string, unknown>>();
  for (const r of base.rows("inspections")) inspectionById.set(canon(r.id), r);
  return { itemsByAudit, inspectionById };
}

/**
 * Site scope: inspection items are cut to those whose inspection belongs to the scope's sites (any
 * state, any date). Every inspection-item analytic joins items to in-scope inspections by audit_id,
 * so items of other sites never count; dropping them changes nothing but the time it takes.
 */
export function siteScoped(base: CacheReader, siteIds: string[], index: BuildIndex): CacheReader {
  const items: Record<string, unknown>[] = [];
  for (const [k, r] of index.inspectionById) if (idIn(r.site_id, siteIds)) for (const it of index.itemsByAudit.get(k) ?? []) items.push(it);
  return narrowed(base, { inspection_items: items });
}

/**
 * One week of schedule compliance: occurrences cut to those due in [from, to), and inspections cut to
 * the ones those occurrences link to (loadOccurrences only reads inspections to find the site of a
 * linked inspection). The period filter inside the analytic selects exactly these occurrences.
 */
export function occurrenceWindow(base: CacheReader, from: number, to: number, index: BuildIndex): { reader: CacheReader; occurrences: number } {
  const occ = base.rows("schedule_occurrences").filter((r) => {
    const due = Date.parse(String(r.due_time ?? ""));
    return Number.isFinite(due) && due >= from && due < to;
  });
  const inspections = new Set<Record<string, unknown>>();
  for (const o of occ) {
    const id = str(o.audit_id);
    const r = id ? index.inspectionById.get(canon(id)) : undefined;
    if (r) inspections.add(r);
  }
  return { reader: narrowed(base, { schedule_occurrences: occ, inspections: [...inspections] }), occurrences: occ.length };
}

/** Earliest date_completed of any non-archived inspection in the cache (where the calendar's records begin). */
export function earliestCompleted(base: CacheReader): number | undefined {
  let min: number | undefined;
  for (const r of base.rows("inspections")) {
    if (bool(r.archived)) continue;
    const t = Date.parse(String(r.date_completed ?? ""));
    if (Number.isFinite(t) && (min === undefined || t < min)) min = t;
  }
  return min;
}
