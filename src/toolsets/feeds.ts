import { z } from "zod";
import { asSqlite, syncFeeds } from "../cache/index.js";
import type { FeedName } from "../cache/contract.js";
import { DEFAULT_SYNC_FEEDS, FEED_NAMES, FEEDS } from "../cache/feeds.js";
import { QUERY_ROW_CAP, runReadOnlyQuery } from "../cache/query.js";
import { DEFAULT_MAX_ROWS } from "../cache/sync.js";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, type AnyToolSpec, keyFor } from "../core/registry.js";
import { parsePeriod } from "../core/time.js";
import { filterRows, safeStem, timestampSlug, writeDataset } from "../exports/dataset.js";

/**
 * Raw Data Feeds and the local analytics cache: list, peek, sync, status, export, SQL.
 * Sync and export only write local files (the cache and config.exportDir); nothing changes in Mitti.
 */

const feedName = z.enum(FEED_NAMES);
const READ_FEED_MAX = 200;

const ageMinutes = (iso: string | null, now: Date) => (iso ? Math.round((now.getTime() - Date.parse(iso)) / 60_000) : null);

export const feedsTools: AnyToolSpec[] = [
  defineTool({
    name: "sc_list_feeds",
    title: "List data feeds",
    toolset: "feeds",
    access: "read",
    description:
      "Lists the Data Feeds this server can mirror into its local cache: what each contains, whether it syncs incrementally, how many rows are cached and how fresh they are.",
    input: {},
    run: async (_a, ctx) => {
      const store = asSqlite(await ctx.cache.open());
      const now = ctx.now();
      const details = new Map(store.details().map((d) => [d.feed, d]));
      const rows = FEED_NAMES.map((name) => {
        const def = FEEDS[name];
        const d = details.get(name)!;
        return {
          feed: name,
          contains: def.description,
          path: def.path,
          incremental: Boolean(def.incremental),
          cached_rows: d.rows,
          last_synced_at: d.last_synced_at,
          age_minutes: ageMinutes(d.last_synced_at, now),
          complete: d.complete,
          unavailable: d.unavailable ?? undefined,
          last_error: d.last_error ?? undefined,
        };
      });
      const synced = rows.filter((r) => r.last_synced_at).length;
      return { summary: `${rows.length} feeds; ${synced} synced into the local cache.`, data: { feeds: rows } };
    },
  }),

  defineTool({
    name: "sc_read_feed",
    title: "Read one page of a feed",
    toolset: "feeds",
    access: "read",
    description:
      "Fetches one page of raw rows straight from a live Data Feed (not the cache), optionally only rows modified after a time. Use it to inspect field names or recent changes; use sc_sync + sc_query_cache for whole data sets.",
    input: {
      feed: feedName.describe("Feed to read (see sc_list_feeds)."),
      modified_after: z
        .string()
        .datetime({ offset: true })
        .optional()
        .describe("Only rows modified after this time (ISO 8601, e.g. 2026-10-01T00:00:00Z). Only for feeds that sync incrementally."),
      limit: P.limit(20, READ_FEED_MAX),
      page_token: z.string().optional().describe("next_page_token from a previous call, to read the following page."),
    },
    run: async ({ feed, modified_after, limit, page_token }, ctx) => {
      const def = FEEDS[feed as FeedName];
      const size = limit ?? 20;
      let path: string;
      if (page_token) {
        // The token is the API's own next_page path; only accept it for the same feed.
        if (!page_token.startsWith(`${def.path}?`) && page_token !== def.path)
          throw new ToolError(`page_token does not belong to the ${feed} feed. Use the next_page_token returned by the previous call.`);
        path = page_token;
      } else {
        const query: Record<string, string | number> = { ...def.query, limit: size };
        if (modified_after) {
          if (!def.incremental) throw new ToolError(`The ${feed} feed has no modified-after filter. Omit modified_after.`);
          query[def.incremental] = new Date(modified_after).toISOString();
        }
        path = ctx.client.url(def.path, query).slice(ctx.config.baseUrl.length);
      }
      const page = await ctx.client.get<{ data?: Record<string, unknown>[]; metadata?: { next_page?: string | null; remaining_records?: number } }>(path);
      const rows = (page.data ?? []).slice(0, size);
      const next = page.metadata?.next_page ?? null;
      return {
        summary: `${rows.length} rows from the ${feed} feed${next ? "; more available (pass next_page_token)" : ""}.`,
        data: { feed, rows, next_page_token: next ?? undefined, remaining_records: page.metadata?.remaining_records },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_sync",
    title: "Sync the local cache",
    toolset: "feeds",
    access: "read",
    localWrite: true,
    core: true,
    description:
      "Pulls Data Feeds into the local analytics cache (only the local cache file is written; nothing changes in Mitti). Incremental by default; full re-pulls everything. Returns per-feed rows fetched, completeness and errors.",
    input: {
      feeds: z
        .array(feedName)
        .min(1)
        .optional()
        .describe(`Feeds to sync. Default: ${DEFAULT_SYNC_FEEDS.join(", ")}.`),
      full: z.boolean().optional().describe("Ignore the saved watermark and re-pull each feed from the start (default false)."),
      max_rows: z
        .number()
        .int()
        .min(100)
        .max(1_000_000)
        .optional()
        .describe(`Row cap per feed (default ${DEFAULT_MAX_ROWS}). A capped feed is reported as complete: false.`),
    },
    run: async ({ feeds, full, max_rows }, ctx) => {
      const started = Date.now();
      const wanted = (feeds ?? DEFAULT_SYNC_FEEDS) as FeedName[];
      const job = syncFeeds(ctx, wanted, { full, maxRows: max_rows });
      job.catch(() => undefined);
      // Stay under MCP client request timeouts: a slow first sync keeps running in the background.
      const budget = Number(process.env.SC_SYNC_BUDGET_MS ?? 40_000);
      let timer: NodeJS.Timeout | undefined;
      const done = await Promise.race([job.then((r) => r), new Promise<undefined>((r) => (timer = setTimeout(() => r(undefined), budget)))]);
      clearTimeout(timer);
      if (!done)
        return {
          summary: `Sync of ${wanted.length} feeds is still running in the background after ${Math.round(budget / 1000)} s (some Mitti feeds are slow on first download). Call sc_sync_status in a minute to see progress; analytics will use whatever has arrived and say so.`,
          data: { feeds: wanted, background: true },
        };
      const { reports } = done;
      const ok = reports.filter((r) => !r.error && !r.unavailable);
      const fetched = reports.reduce((n, r) => n + r.fetched, 0);
      const unavailable = reports.filter((r) => r.unavailable).map((r) => r.feed);
      const failed = reports.filter((r) => r.error).map((r) => r.feed);
      const partial = reports.filter((r) => !r.complete && !r.error).map((r) => r.feed);
      const parts = [`Synced ${ok.length} of ${reports.length} feeds (${fetched} rows fetched)`];
      if (partial.length) parts.push(`partial (row cap): ${partial.join(", ")}`);
      if (unavailable.length) parts.push(`unavailable: ${unavailable.join(", ")}`);
      if (failed.length) parts.push(`failed: ${failed.join(", ")}`);
      return {
        summary: `${parts.join("; ")}.`,
        data: { feeds: reports, total_duration_ms: Date.now() - started },
      };
    },
  }),

  defineTool({
    name: "sc_sync_status",
    title: "Cache sync status",
    toolset: "feeds",
    access: "read",
    core: true,
    description:
      "Shows, per feed, how many rows are in the local cache, when it was last synced, whether the sync was complete, and any error; plus the cache file path and size.",
    input: { feeds: z.array(feedName).optional().describe("Limit to these feeds (default: all).") },
    run: async ({ feeds }, ctx) => {
      const store = asSqlite(await ctx.cache.open());
      const now = ctx.now();
      const rows = store.details(feeds as FeedName[] | undefined).map((d) => ({
        feed: d.feed,
        rows: d.rows,
        last_synced_at: d.last_synced_at,
        age_minutes: ageMinutes(d.last_synced_at, now),
        watermark: d.watermark,
        complete: d.complete,
        unavailable: d.unavailable ?? undefined,
        last_error: d.last_error ?? undefined,
      }));
      const synced = rows.filter((r) => r.last_synced_at);
      const bytes = store.sizeBytes();
      return {
        summary: `${synced.length} of ${rows.length} feeds synced, ${synced.reduce((n, r) => n + r.rows, 0)} rows cached (${(bytes / 1_048_576).toFixed(1)} MB).`,
        data: { cache_file: store.path, size_bytes: bytes, feeds: rows },
      };
    },
  }),

  defineTool({
    name: "sc_export_dataset",
    title: "Export a cached feed to CSV / JSONL",
    toolset: "feeds",
    access: "read",
    localWrite: true,
    core: true,
    description:
      "Writes a cached feed, or a filtered subset (period on a date field, sites, templates), to a CSV or JSONL file in the export folder and returns the path, row count and columns. Syncs the feed first if it is older than an hour. Emails/names follow the privacy level (SC_PII).",
    input: {
      feed: feedName.describe("Feed to export (see sc_list_feeds)."),
      format: z.enum(["csv", "jsonl"]).optional().describe("File format (default csv). CSV flattens nested values to JSON text."),
      period: z
        .string()
        .optional()
        .describe('Only rows whose date_field falls in this window, e.g. "last 90 days", "2026-Q3". Default: all rows.'),
      date_field: z
        .string()
        .regex(/^[A-Za-z0-9_]+$/)
        .optional()
        .describe("Row field the period applies to (default: the feed's modified field, else created_at). Examples: created_at, date_completed, due_time."),
      site_ids: P.siteIds,
      template_ids: P.templateIds,
      columns: z.array(z.string()).optional().describe("Only these columns, in this order (default: every field)."),
      file_name: z.string().max(80).optional().describe("File name without folder (default: <feed>-<timestamp>)."),
    },
    run: async (args, ctx) => {
      const feed = args.feed as FeedName;
      const cache = await ctx.cache.ensure([feed]);
      const [status] = cache.status([feed]);
      if (!status?.last_synced_at) throw new ToolError(`The ${feed} feed could not be synced${status?.last_error ? `: ${status.last_error.replace(/\.+$/, "")}` : ""}. Run sc_sync_status.`);
      const now = ctx.now();
      const period = args.period ? parsePeriod(args.period, now) : undefined;
      const dateField = args.date_field ?? FEEDS[feed].modifiedField ?? "created_at";
      const rows = filterRows(cache.rows(feed), { period, dateField, siteIds: args.site_ids, templateIds: args.template_ids });
      const stem = args.file_name ? safeStem(args.file_name) : `${feed}-${timestampSlug(now)}`;
      const out = writeDataset({ dir: ctx.config.exportDir, stem, format: args.format ?? "csv", rows, pii: ctx.config.pii, key: keyFor(ctx.config), columns: args.columns });
      const caveat = status.complete ? "" : " The cached feed is partial (row cap), so the file may be incomplete.";
      return {
        summary: `Exported ${out.rows} ${feed} rows to ${out.path}.${caveat}`,
        data: {
          path: out.path,
          rows: out.rows,
          columns: out.columns,
          filters: { period: period?.label, date_field: period ? dateField : undefined, site_ids: args.site_ids, template_ids: args.template_ids },
          cache: { last_synced_at: status.last_synced_at, complete: status.complete },
        },
      };
    },
  }),

  defineTool({
    name: "sc_query_cache",
    title: "SQL over the local cache",
    toolset: "feeds",
    access: "read",
    description: `Runs one read-only SQL SELECT (SQLite) over the local cache for ad-hoc analysis. Tables: feed_<name>(id, modified_at, data) where data is the raw row as JSON, e.g. SELECT json_extract(data,'$.site_id') AS site, COUNT(*) FROM feed_inspections GROUP BY 1. Max ${QUERY_ROW_CAP} rows, 10 s. Run sc_sync first.`,
    input: {
      sql: z.string().min(1).max(20_000).describe("A single SELECT or WITH ... SELECT statement. No PRAGMA, ATTACH or writes."),
      limit: P.limit(QUERY_ROW_CAP, QUERY_ROW_CAP),
    },
    run: async ({ sql, limit }, ctx) => {
      // Raw SQL returns whatever columns the query builds (e.g. firstname || lastname), so strict
      // privacy cannot be guaranteed for it: fail closed instead of leaking names.
      if (ctx.config.pii === "strict")
        throw new ToolError("sc_query_cache is disabled when SC_PII=strict, because ad-hoc SQL can rebuild names the privacy policy would hide. Use the analytics or export tools instead.");
      const store = asSqlite(await ctx.cache.open());
      const res = await runReadOnlyQuery(store.path, sql, { rowCap: limit ?? QUERY_ROW_CAP });
      return {
        summary: `${res.rows.length} rows${res.truncated ? ` (cut short by the ${res.truncated_reason === "bytes" ? "size" : "row"} cap; add LIMIT, select fewer columns or aggregate)` : ""} in ${res.duration_ms} ms.`,
        data: { columns: res.columns, rows: res.rows, truncated: res.truncated, truncated_reason: res.truncated_reason },
        untrusted: true,
      };
    },
  }),
];
