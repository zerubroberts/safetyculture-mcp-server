import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEED_NAMES, FEEDS } from "../../src/cache/feeds.js";
import { cacheFilePath, orgFingerprint } from "../../src/cache/store.js";
import { isSqliteExperimentalWarning } from "../../src/cache/sqlite.js";
import { inspection, tempStore } from "./helpers.js";

describe("cache store", () => {
  it("names the file by a 16-hex fingerprint of the organisation id", () => {
    expect(orgFingerprint("role_demo_org")).toMatch(/^[0-9a-f]{16}$/);
    expect(cacheFilePath("/data", "role_demo_org")).toContain(`${orgFingerprint("role_demo_org")}.sqlite`);
    expect(cacheFilePath("/data", "role_demo_org")).not.toContain("role_demo_org");
  });

  it("creates one table per feed and an owner-only file", () => {
    const store = tempStore();
    expect(store.status().map((s) => s.feed)).toEqual(FEED_NAMES);
    if (process.platform !== "win32") expect(statSync(store.path).mode & 0o777).toBe(0o600);
    store.close();
  });

  it("upserts idempotently: same id twice keeps one row with the newer data", () => {
    const store = tempStore();
    expect(store.upsert("inspections", [inspection(1, "2026-01-01T00:00:00Z"), inspection(2, "2026-01-02T00:00:00Z")])).toBe(2);
    store.upsert("inspections", [inspection(1, "2026-01-05T00:00:00Z", { name: "Renamed" })]);
    const rows = store.rows<{ id: string; name: string }>("inspections");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "audit_0001")!.name).toBe("Renamed");
    expect(store.rows<{ id: string }>("inspections", (r) => r.id === "audit_0002")).toHaveLength(1);
    store.close();
  });

  it("uses composite keys for feeds without an id and skips keyless rows", () => {
    const store = tempStore();
    const n = store.upsert("group_users", [
      { group_id: "g1", user_id: "u1" },
      { group_id: "g1", user_id: "u1" },
      { group_id: "g1", user_id: "u2" },
      { group_id: "g2" },
    ]);
    expect(n).toBe(3);
    expect(store.status(["group_users"])[0]!.rows).toBe(2);
    expect(FEEDS.site_members.key({ site_id: "s1", member_id: "m1" })).toBe("s1:m1");
    expect(FEEDS.action_assignees.key({ action_id: "a1", assignee_id: "u1" })).toBe("a1:u1");
    expect(FEEDS.action_assignees.key({ id: "x", action_id: "a1", assignee_id: "u1" })).toBe("x");
    expect(FEEDS.training_course_progress.key({ userId: "u1", courseId: "c1" })).toBe("u1:c1");
    store.close();
  });

  it("tracks state per feed and reset clears rows and state", () => {
    const store = tempStore();
    store.upsert("sites", [{ id: "site-1", name: "Demo Depot" }]);
    store.setState("sites", { last_synced_at: "2026-10-08T00:00:00.000Z", complete: true, watermark: null });
    store.setState("sites", { last_error: "boom" });
    expect(store.status(["sites"])[0]).toEqual({
      feed: "sites",
      rows: 1,
      last_synced_at: "2026-10-08T00:00:00.000Z",
      watermark: null,
      complete: true,
      last_error: "boom",
    });
    store.reset("sites");
    expect(store.status(["sites"])[0]).toMatchObject({ rows: 0, last_synced_at: null, complete: false });
    store.close();
  });

  it("replace swaps the whole table atomically", () => {
    const store = tempStore();
    store.upsert("groups", [{ id: "g1" }, { id: "g2" }]);
    store.replace("groups", [{ id: "g3" }]);
    expect(store.rows<{ id: string }>("groups").map((r) => r.id)).toEqual(["g3"]);
    store.close();
  });

  it("only the SQLite experimental warning is muted", () => {
    expect(isSqliteExperimentalWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning")).toBe(true);
    expect(isSqliteExperimentalWarning("WASI is an experimental feature", "ExperimentalWarning")).toBe(false);
    expect(isSqliteExperimentalWarning("SQLite something", "DeprecationWarning")).toBe(false);
  });
});
