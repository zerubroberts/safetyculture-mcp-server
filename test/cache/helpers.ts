import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScClient } from "../../src/core/client.js";
import { SqliteCache } from "../../src/cache/store.js";
import { MockApi, testConfig, type Recorded } from "../helpers/mock-api.js";

export function tempStore(): SqliteCache {
  const dir = mkdtempSync(join(tmpdir(), "scmcp-cache-"));
  return new SqliteCache(join(dir, "cache", "0123456789abcdef.sqlite"));
}

export function client(api: MockApi): ScClient {
  return new ScClient(testConfig(), api.fetch);
}

/**
 * A paginated synthetic feed: serves `rows` in pages of `pageSize` (or the request's limit),
 * linking pages through next_page with an `after` cursor, as the real feeds do.
 */
export function pagedFeed(path: string, rows: Record<string, unknown>[], opts: { pageSize?: number } = {}) {
  return (req: Recorded) => {
    const size = opts.pageSize ?? Number(req.query.limit ?? 20);
    const start = Number(req.query.after ?? 0);
    const page = rows.slice(start, start + size);
    const nextStart = start + size;
    const q = new URLSearchParams({ ...req.query, after: String(nextStart) });
    return { data: page, metadata: { next_page: nextStart < rows.length ? `${path}?${q}` : null, remaining_records: Math.max(0, rows.length - nextStart) } };
  };
}

export const inspection = (i: number, modified: string, extra: Record<string, unknown> = {}) => ({
  id: `audit_${String(i).padStart(4, "0")}`,
  name: `Demo inspection ${i}`,
  template_id: "template_demo1",
  site_id: "site-1",
  owner_id: "user_demo1",
  modified_at: modified,
  ...extra,
});
