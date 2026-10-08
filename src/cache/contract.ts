/**
 * Local analytics cache: contract shared by the sync engine (src/cache/store.ts, src/cache/sync.ts)
 * and the analytics layer (src/analytics/**). Analytics code depends ONLY on this file, so both
 * sides can be built and tested independently.
 *
 * Storage: one SQLite file per organisation (node:sqlite, no native dependencies) at
 * <dataDir>/cache/<org-fingerprint>.sqlite, file mode 0600. Each feed is a table
 *   feed_<name>(id TEXT PRIMARY KEY, modified_at TEXT, data TEXT /* raw JSON row *\/)
 * plus a sync_state table. Rows are stored losslessly; analytics read typed objects.
 */

export type FeedName =
  | "inspections"
  | "inspection_items"
  | "templates"
  | "sites"
  | "users"
  | "groups"
  | "group_users"
  | "site_members"
  | "actions"
  | "action_assignees"
  | "action_timeline_items"
  | "issues"
  | "issue_timeline_items"
  | "schedules"
  | "schedule_assignees"
  | "schedule_occurrences"
  | "assets"
  | "activity_log_events"
  | "credentials"
  | "credential_types"
  | "contractor_companies"
  | "training_course_progress"
  | "investigations";

export interface FeedDef {
  name: FeedName;
  /** API path of the Data Feed. */
  path: string;
  /** How to derive the primary key of a row (feeds without an `id` use a composite). */
  key: (row: Record<string, unknown>) => string;
  /** Query parameter for incremental pulls, if the feed supports one. */
  incremental?: "modified_after" | "triggered_after";
  /** Field that carries the row's last-modified time, used as the watermark. */
  modifiedField?: string;
  /** Default page size (some feeds reject more than 100). */
  pageSize?: number;
  /** Extra fixed query parameters (e.g. include archived/incomplete records). */
  query?: Record<string, string>;
  description: string;
}

export interface FeedStatus {
  feed: FeedName;
  rows: number;
  last_synced_at: string | null;
  watermark: string | null;
  complete: boolean;
  last_error: string | null;
  /** Set when the API refused the feed (403/404: module not licensed or no permission). */
  unavailable?: string | null;
}

export interface SyncReport {
  feed: FeedName;
  fetched: number;
  upserted: number;
  pages: number;
  full: boolean;
  duration_ms: number;
  error?: string;
}

/** Read side used by analytics. Implementations must be synchronous-safe and read-only here. */
export interface CacheReader {
  /** All rows of a feed as parsed objects. Optional predicate filters in JS. */
  rows<T = Record<string, unknown>>(feed: FeedName, filter?: (row: T) => boolean): T[];
  /** Per-feed freshness, so every analytic can state its data window honestly. */
  status(feeds?: FeedName[]): FeedStatus[];
}

/** Write side used by the sync tools. */
export interface CacheWriter extends CacheReader {
  upsert(feed: FeedName, rows: Record<string, unknown>[]): number;
  setState(feed: FeedName, patch: Partial<Omit<FeedStatus, "feed" | "rows">>): void;
  reset(feed?: FeedName): void;
  close(): void;
  readonly path: string;
}

/**
 * What every analytics tool returns inside `data`. The summary sentence quotes `coverage`.
 * Numbers in `metrics` / `table` must be computed from cached rows, never estimated.
 */
export interface AnalyticResult<Row = Record<string, unknown>> {
  metric_version: string;
  period?: { from: string; to: string; label: string };
  filters: Record<string, unknown>;
  as_of: string;
  coverage: Array<
    Pick<FeedStatus, "feed" | "rows" | "last_synced_at" | "complete"> & {
      note?: string;
      /** The API refused the feed (module not licensed or no permission). */
      unavailable?: string;
      /** Why the latest refresh failed; the cached rows predate it. */
      last_error?: string;
      /** Minutes since the last successful sync, relative to as_of. */
      age_minutes?: number;
    }
  >;
  metrics: Record<string, number | string | null>;
  table: Row[];
  method: string;
  caveats: string[];
}
