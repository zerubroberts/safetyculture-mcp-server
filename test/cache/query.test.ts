import { describe, expect, it } from "vitest";
import { guardQuery, QUERY_CHILD_HEAP_MB, QUERY_MAX_BYTES, runReadOnlyQuery } from "../../src/cache/query.js";
import { ToolError } from "../../src/core/errors.js";
import { tempStore } from "./helpers.js";

describe("query guard", () => {
  it.each([
    ["ATTACH DATABASE '/tmp/x.db' AS x", /SELECT/],
    ["SELECT * FROM feed_sites WHERE id IN (SELECT 1) ATTACH DATABASE 'x' AS y", /ATTACH/],
    ["SELECT 1; ATTACH DATABASE 'x' AS y", /one statement/],
    ["PRAGMA table_info(feed_sites)", /SELECT/],
    ["SELECT * FROM pragma_table_info('feed_sites') WHERE 1 AND (SELECT 1 FROM x) PRAGMA", /PRAGMA/],
    ["INSERT INTO feed_sites VALUES ('a', null, '{}')", /SELECT/],
    ["WITH x AS (SELECT 1) DELETE FROM feed_sites", /DELETE/],
    ["WITH x AS (SELECT 1) INSERT INTO feed_sites SELECT * FROM x", /INSERT/],
    ["SELECT 1; SELECT 2", /one statement/],
    ["SELECT * FROM pragma_table_info('feed_sites')", /PRAGMA/],
    ["SELECT file FROM pragma_database_list", /PRAGMA/],
    ["SELECT 1 /* hidden */; DROP TABLE feed_sites", /one statement/],
    ["SELECT load_extension('evil')", /load_extension/],
    ["REPLACE INTO feed_sites VALUES (1,2,3)", /SELECT/],
    ["", /SELECT/],
  ])("rejects %s", (sql, msg) => {
    expect(() => guardQuery(sql)).toThrow(msg);
  });

  it.each([
    "SELECT id FROM feed_sites",
    "select count(*) from feed_inspections;",
    "WITH s AS (SELECT json_extract(data, '$.name') AS name FROM feed_sites) SELECT name FROM s",
    "SELECT replace(id, 'a', 'b') FROM feed_sites",
    "SELECT 'drop; table; delete' AS text_is_data",
    "SELECT \"updated\" FROM (SELECT 1 AS \"updated\") -- trailing comment",
  ])("accepts %s", (sql) => {
    expect(() => guardQuery(sql)).not.toThrow();
  });

  // SEC-FIX-2 finding 3: quoted identifiers name table-valued functions in SQLite, so the raw text
  // (comments removed, quotes kept) is checked as well as the structure.
  it.each([
    'SELECT * FROM "pragma_database_list"',
    "SELECT * FROM [pragma_table_list]",
    "SELECT * FROM `pragma_database_list`",
    'SELECT name FROM "PRAGMA_TABLE_INFO"(\'feed_sites\')',
    "SELECT * FROM main.\"pragma_database_list\"",
    "SELECT * FROM [Pragma_Table_List] /* comment */",
  ])("rejects quoted pragma form %s", (sql) => {
    expect(() => guardQuery(sql)).toThrow(/PRAGMA/);
  });

  it.each([
    ['SELECT "load_extension"(\'x\')', /load_extension/],
    ["SELECT [readfile]('/etc/hosts')", /readfile/],
    ["SELECT `writefile`('x', 'y')", /writefile/],
    ["SELECT 'attach' AS literal_false_positive_is_accepted", /ATTACH/],
  ])("rejects quoted dangerous name %s", (sql, msg) => {
    expect(() => guardQuery(sql)).toThrow(msg);
  });

  it("the raw check ignores comments and whole-word lookalikes but not quoted identifiers", () => {
    expect(() => guardQuery("SELECT id FROM feed_sites /* attach and pragma only in a comment */")).not.toThrow();
    expect(() => guardQuery("SELECT json_extract(data, '$.attachments') AS files FROM feed_actions -- no pragma here")).not.toThrow();
    expect(() => guardQuery("SELECT id FROM \"pragma_table_list\" -- the identifier is checked, not only this comment")).toThrow(/PRAGMA/);
  });

  it("the runner refuses quoted pragma forms before starting a child", async () => {
    const store = tempStore();
    await expect(runReadOnlyQuery(store.path, 'SELECT file FROM "pragma_database_list"')).rejects.toThrow(/PRAGMA/);
    store.close();
  });
});

// SEC-FIX-2 finding 4: rows stream against a byte budget; the child's heap is capped.
describe("query result memory limits", () => {
  const rowsOf = (n: number, size: number) =>
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n}) SELECT x, printf('%.*c', ${size}, 'x') AS big FROM c`;

  it("many large rows: stops at the byte budget and reports truncation", async () => {
    const store = tempStore();
    const res = await runReadOnlyQuery(store.path, rowsOf(200, 200_000));
    expect(res.truncated).toBe(true);
    expect(res.truncated_reason).toBe("bytes");
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeLessThan(200);
    expect(JSON.stringify(res.rows).length).toBeLessThanOrEqual(QUERY_MAX_BYTES);
    store.close();
  }, 30_000);

  it("the row cap is still reported as the reason when rows are small", async () => {
    const store = tempStore();
    const res = await runReadOnlyQuery(store.path, rowsOf(50, 10), { rowCap: 5 });
    expect(res).toMatchObject({ truncated: true, truncated_reason: "rows" });
    expect(res.rows).toHaveLength(5);
    store.close();
  });

  it("one row bigger than the budget: a ToolError from the child's budget check", async () => {
    const store = tempStore();
    const err = await runReadOnlyQuery(store.path, rowsOf(3, 9_000_000)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as Error).message).toMatch(/single result row is larger than/);
    store.close();
  }, 30_000);

  it("a value bigger than the child's heap cap: a graceful ToolError (no process crash), the server keeps running", async () => {
    const store = tempStore();
    const err = await runReadOnlyQuery(store.path, `SELECT printf('%.*c', ${(QUERY_CHILD_HEAP_MB + 64) * 1_000_000}, 'x') AS huge`, { timeoutMs: 20_000 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ToolError);
    // Stopped by the child's own budget check or its heap cap, never by a raw crash or the parent's backstop.
    expect((err as Error).message).toMatch(/single result row is larger than|memory limit/);
    // Past V8's maximum string length the child itself dies: contained, reported as a ToolError.
    const crash = await runReadOnlyQuery(store.path, "SELECT printf('%.*c', 600000000, 'x') AS huge", { timeoutMs: 20_000 }).catch((e: unknown) => e);
    expect(crash).toBeInstanceOf(ToolError);
    // Node 22 kills the child (memory limit); Node 24's node:sqlite refuses the oversized value itself.
    expect((crash as Error).message).toMatch(/memory limit|SQLite rejected the query/);
    // Still serving queries afterwards.
    const ok = await runReadOnlyQuery(store.path, "SELECT 1 AS n");
    expect(ok.rows).toEqual([{ n: 1 }]);
    store.close();
  }, 40_000);
});

describe("read-only query runner", () => {
  it("returns rows from a separate read-only connection, capped", async () => {
    const store = tempStore();
    store.upsert(
      "sites",
      Array.from({ length: 12 }, (_, i) => ({ id: `site-${i}`, name: `Demo Depot ${i}` })),
    );
    const res = await runReadOnlyQuery(store.path, "SELECT id, json_extract(data, '$.name') AS name FROM feed_sites ORDER BY id", { rowCap: 5 });
    expect(res.columns).toEqual(["id", "name"]);
    expect(res.rows).toHaveLength(5);
    expect(res.truncated).toBe(true);
    const all = await runReadOnlyQuery(store.path, "SELECT COUNT(*) AS n FROM feed_sites");
    expect(all.rows[0]).toEqual({ n: 12 });
    store.close();
  });

  it("reports SQL errors plainly", async () => {
    const store = tempStore();
    await expect(runReadOnlyQuery(store.path, "SELECT nope FROM feed_sites")).rejects.toThrow(/SQLite rejected the query/);
    store.close();
  });

  it("stops queries at the time cap", async () => {
    const store = tempStore();
    const slow = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT COUNT(*) FROM c";
    await expect(runReadOnlyQuery(store.path, slow, { timeoutMs: 300 })).rejects.toThrow(/stopped after/);
    store.close();
  });
});
