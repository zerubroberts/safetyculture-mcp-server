import { describe, expect, it } from "vitest";
import { guardQuery, runReadOnlyQuery } from "../../src/cache/query.js";
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
    "SELECT 'drop; table; attach' AS text_is_data",
    "SELECT \"updated\" FROM (SELECT 1 AS \"updated\") -- trailing comment",
  ])("accepts %s", (sql) => {
    expect(() => guardQuery(sql)).not.toThrow();
  });
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
