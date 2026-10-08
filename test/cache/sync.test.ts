import { describe, expect, it } from "vitest";
import { syncAll, syncFeed } from "../../src/cache/sync.js";
import { MockApi, type Recorded } from "../helpers/mock-api.js";
import { client, inspection, pagedFeed, tempStore } from "./helpers.js";

const NOW = () => new Date("2026-10-08T00:00:00.000Z");

describe("cache sync", () => {
  it("first run pulls everything with archived/incomplete included and sets the watermark", async () => {
    const rows = [1, 2, 3, 4, 5].map((i) => inspection(i, `2026-09-0${i}T10:00:00Z`));
    const api = new MockApi().on("GET /feed/inspections", pagedFeed("/feed/inspections", rows, { pageSize: 2 }));
    const store = tempStore();
    const r = await syncFeed(client(api), store, "inspections", { now: NOW });
    expect(r).toMatchObject({ feed: "inspections", fetched: 5, upserted: 5, pages: 3, full: true, complete: true });
    expect(api.calls[0]!.query).toMatchObject({ archived: "both", completed: "both", limit: "500" });
    expect(api.calls[0]!.query.modified_after).toBeUndefined();
    expect(store.status(["inspections"])[0]).toMatchObject({ rows: 5, watermark: "2026-09-05T10:00:00.000Z", complete: true, last_error: null });
  });

  it("next run is incremental from watermark minus 10 minutes, and overlap rows dedupe", async () => {
    const first = [1, 2, 3].map((i) => inspection(i, `2026-09-0${i}T10:00:00Z`));
    let served = first;
    const api = new MockApi().on("GET /feed/inspections", (req: Recorded) => pagedFeed("/feed/inspections", served)(req));
    const store = tempStore();
    await syncFeed(client(api), store, "inspections", { now: NOW });

    // Second pull: the API re-sends row 3 (overlap) plus a changed row 1 and a new row 4.
    served = [inspection(3, "2026-09-03T10:00:00Z"), inspection(1, "2026-09-06T08:00:00Z", { name: "Edited" }), inspection(4, "2026-09-06T09:00:00Z")];
    const r = await syncFeed(client(api), store, "inspections", { now: NOW });
    expect(r).toMatchObject({ full: false, fetched: 3, since: "2026-09-03T09:50:00.000Z", complete: true });
    expect(api.calls.at(-1)!.query.modified_after).toBe("2026-09-03T09:50:00.000Z");
    expect(store.status(["inspections"])[0]).toMatchObject({ rows: 4, watermark: "2026-09-06T09:00:00.000Z" });
    expect(store.rows<{ id: string; name: string }>("inspections").find((x) => x.id === "audit_0001")!.name).toBe("Edited");
  });

  it("full: true ignores the watermark", async () => {
    const api = new MockApi().on("GET /feed/inspections", pagedFeed("/feed/inspections", [inspection(1, "2026-09-01T00:00:00Z")]));
    const store = tempStore();
    await syncFeed(client(api), store, "inspections", { now: NOW });
    const r = await syncFeed(client(api), store, "inspections", { now: NOW, full: true });
    expect(r.full).toBe(true);
    expect(api.calls.at(-1)!.query.modified_after).toBeUndefined();
  });

  it("caps the first pull at maxRows and reports complete: false, then re-pulls in full", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => inspection(i, "2026-09-01T00:00:00Z"));
    const api = new MockApi().on("GET /feed/inspections", pagedFeed("/feed/inspections", rows, { pageSize: 10 }));
    const store = tempStore();
    const r = await syncFeed(client(api), store, "inspections", { now: NOW, maxRows: 20 });
    expect(r).toMatchObject({ fetched: 20, complete: false });
    expect(store.status(["inspections"])[0]!.complete).toBe(false);
    const again = await syncFeed(client(api), store, "inspections", { now: NOW, maxRows: 20 });
    expect(again.full).toBe(true);
  });

  it("retries with page size 100 when the feed rejects the larger page with 400", async () => {
    const api = new MockApi().on("GET /feed/actions", (req: Recorded) =>
      Number(req.query.limit) > 100
        ? new Response(JSON.stringify({ message: "limit too large" }), { status: 400 })
        : pagedFeed("/feed/actions", [{ id: "a1", modified_at: "2026-09-01T00:00:00Z" }])(req),
    );
    const store = tempStore();
    const r = await syncFeed(client(api), store, "actions", { now: NOW });
    expect(r).toMatchObject({ fetched: 1, page_size: 100, complete: true });
    expect(api.calls.map((c) => c.query.limit)).toEqual(["500", "100"]);
  });

  it("stops on a repeating cursor and records last_error, keeping the rows it got", async () => {
    const api = new MockApi().on("GET /feed/issues", () => ({ data: [{ id: "i1" }], metadata: { next_page: "/feed/issues?cursor=same" } }));
    const store = tempStore();
    const r = await syncFeed(client(api), store, "issues", { now: NOW });
    expect(r.complete).toBe(false);
    expect(r.error).toMatch(/repeating page cursor/);
    const [s] = store.status(["issues"]);
    expect(s).toMatchObject({ rows: 1, complete: false });
    expect(s!.last_error).toMatch(/repeating page cursor/);
  });

  it("records 403/404 feeds as unavailable without failing the other feeds", async () => {
    const api = new MockApi()
      .on("GET /credentials/v1/feed/credentials", () => new Response(JSON.stringify({ message: "module not enabled" }), { status: 403 }))
      .on("GET /feed/sites", pagedFeed("/feed/sites", [{ id: "site-1", name: "Demo Depot" }]));
    // /companies/v1/feed/companies has no route: the mock answers 404.
    const store = tempStore();
    const reports = await syncAll(client(api), store, ["credentials", "contractor_companies", "sites"], { now: NOW });
    expect(reports.map((r) => [r.feed, Boolean(r.unavailable), r.error ?? null])).toEqual([
      ["credentials", true, null],
      ["contractor_companies", true, null],
      ["sites", false, null],
    ]);
    expect(reports[0]!.unavailable).toContain("module not enabled");
    const d = store.details(["credentials", "sites"]);
    expect(d[0]).toMatchObject({ rows: 0, complete: true, last_error: null });
    expect(d[0]!.unavailable).toContain("HTTP 403");
    expect(d[1]).toMatchObject({ rows: 1, unavailable: null });
  });

  it("a 403 after earlier syncs keeps the rows but marks them incomplete and not freshly synced", async () => {
    let refuse = false;
    const api = new MockApi().on("GET /feed/sites", (req: Recorded) =>
      refuse ? new Response(JSON.stringify({ message: "no permission" }), { status: 403 }) : pagedFeed("/feed/sites", [{ id: "site-1", name: "Demo Depot" }])(req),
    );
    const store = tempStore();
    await syncFeed(client(api), store, "sites", { now: NOW });
    refuse = true;
    const r = await syncFeed(client(api), store, "sites", { now: () => new Date("2026-10-09T00:00:00.000Z") });
    expect(r).toMatchObject({ complete: false });
    expect(r.unavailable).toContain("HTTP 403");
    expect(r.error).toMatch(/no longer current/);
    const [s] = store.status(["sites"]);
    expect(s).toMatchObject({ rows: 1, complete: false, last_synced_at: "2026-10-08T00:00:00.000Z" });
    expect(s!.unavailable).toContain("no permission");
    expect(s!.last_error).toMatch(/Access refused/);
  });

  it("a capped full refresh never mixes into a previous complete snapshot", async () => {
    let served = [1, 2, 3, 4, 5].map((i) => inspection(i, "2026-09-01T00:00:00Z"));
    const api = new MockApi().on("GET /feed/inspections", (req: Recorded) => pagedFeed("/feed/inspections", served, { pageSize: 10 })(req));
    const store = tempStore();
    await syncFeed(client(api), store, "inspections", { now: NOW });
    // Upstream: rows 1-5 deleted, 30 new rows; the forced full refresh hits the 20-row cap.
    served = Array.from({ length: 30 }, (_, i) => inspection(100 + i, "2026-09-10T00:00:00Z"));
    const r = await syncFeed(client(api), store, "inspections", { now: () => new Date("2026-10-09T00:00:00.000Z"), full: true, maxRows: 20 });
    expect(r).toMatchObject({ fetched: 20, upserted: 0, complete: false });
    expect(r.error).toMatch(/20-row cap.*previous complete snapshot/);
    const [s] = store.status(["inspections"]);
    expect(s).toMatchObject({ rows: 5, complete: true, last_synced_at: "2026-10-08T00:00:00.000Z" });
    expect(s!.last_error).toMatch(/previous complete snapshot from 2026-10-08/);
    expect(store.rows<{ id: string }>("inspections").map((x) => x.id)).toEqual(["audit_0001", "audit_0002", "audit_0003", "audit_0004", "audit_0005"]);
  });

  it("a capped full pull over a previous partial snapshot replaces it instead of accumulating rows", async () => {
    let served = Array.from({ length: 30 }, (_, i) => inspection(i, "2026-09-01T00:00:00Z"));
    const api = new MockApi().on("GET /feed/inspections", (req: Recorded) => pagedFeed("/feed/inspections", served, { pageSize: 10 })(req));
    const store = tempStore();
    await syncFeed(client(api), store, "inspections", { now: NOW, maxRows: 20 });
    served = Array.from({ length: 30 }, (_, i) => inspection(100 + i, "2026-09-10T00:00:00Z"));
    const r = await syncFeed(client(api), store, "inspections", { now: NOW, maxRows: 20 });
    expect(r).toMatchObject({ full: true, fetched: 20, complete: false });
    expect(store.status(["inspections"])[0]).toMatchObject({ rows: 20, complete: false });
    expect(store.rows<{ id: string }>("inspections").every((x) => x.id >= "audit_0100")).toBe(true);
  });

  it("records other API errors as last_error and continues", async () => {
    const api = new MockApi()
      .on("GET /feed/users", () => new Response("bad", { status: 400 }))
      .on("GET /feed/groups", pagedFeed("/feed/groups", [{ id: "g1", name: "Demo group" }]));
    const store = tempStore();
    const reports = await syncAll(client(api), store, ["users", "groups"], { now: NOW });
    expect(reports[0]!.error).toMatch(/400/);
    expect(store.status(["users"])[0]!.last_error).toMatch(/400/);
    expect(reports[1]).toMatchObject({ fetched: 1, complete: true });
  });

  it("feeds without an incremental filter replace the table, so upstream deletions disappear", async () => {
    let served: Record<string, unknown>[] = [
      { group_id: "g1", user_id: "u1" },
      { group_id: "g1", user_id: "u2" },
    ];
    const api = new MockApi().on("GET /feed/group_users", (req: Recorded) => pagedFeed("/feed/group_users", served)(req));
    const store = tempStore();
    await syncFeed(client(api), store, "group_users", { now: NOW });
    served = [{ group_id: "g1", user_id: "u1" }];
    const r = await syncFeed(client(api), store, "group_users", { now: NOW });
    expect(r.full).toBe(true);
    expect(store.status(["group_users"])[0]!.rows).toBe(1);
  });

  it("uses triggered_after for the activity log and page size 250", async () => {
    const api = new MockApi().on(
      "GET /feed/activity_log_events",
      pagedFeed("/feed/activity_log_events", [{ id: "e1", event_at: "2026-09-01T00:00:00Z" }]),
    );
    const store = tempStore();
    await syncFeed(client(api), store, "activity_log_events", { now: NOW });
    await syncFeed(client(api), store, "activity_log_events", { now: NOW });
    expect(api.calls[0]!.query.limit).toBe("250");
    expect(api.calls.at(-1)!.query.triggered_after).toBe("2026-08-31T23:50:00.000Z");
  });

  it("shares one in-flight sync between concurrent callers", async () => {
    const api = new MockApi().on("GET /feed/templates", pagedFeed("/feed/templates", [{ id: "template_1", modified_at: "2026-09-01T00:00:00Z" }]));
    const store = tempStore();
    const c = client(api);
    const [a, b] = await Promise.all([syncFeed(c, store, "templates", { now: NOW }), syncFeed(c, store, "templates", { now: NOW })]);
    expect(a).toBe(b);
    expect(api.calls).toHaveLength(1);
  });
});
