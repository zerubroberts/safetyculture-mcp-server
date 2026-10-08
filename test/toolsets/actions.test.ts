import { describe, expect, it } from "vitest";
import { ACTION_STATUS, buildTaskFilters } from "../../src/toolsets/actions.js";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixture: no real organisation data.
const task = (id: string, extra: Record<string, unknown> = {}) => ({
  task: {
    task_id: id,
    unique_id: `A-${id}`,
    title: `Fix item ${id}`,
    status_id: ACTION_STATUS.to_do,
    priority_id: "02eb40c1-4f46-40c5-be16-d32941c96ec9",
    due_at: "2026-01-01T00:00:00Z",
    collaborators: [{ assigned_role: "ASSIGNEE", user: { user_id: "user_1", firstname: "Alex", lastname: "Demo" } }],
    site: { id: "site-1", name: "Demo Depot" },
    ...extra,
  },
});

describe("actions toolset", () => {
  it("builds AND-ed filter objects with OR-ed values", () => {
    const f = buildTaskFilters({ status: ["to_do", "in_progress"], site_ids: ["s1", "s2"], overdue_only: true }, new Date("2026-10-08T00:00:00Z"));
    expect(f).toContainEqual({ status_id: { value: [ACTION_STATUS.to_do, ACTION_STATUS.in_progress] } });
    expect(f).toContainEqual({ site_id: { value: ["s1", "s2"] } });
    expect(f).toContainEqual({ due_at: { to: { time: "2026-10-08T00:00:00.000Z" } } });
  });

  it("lists actions as compact rows with overdue days and untrusted wrapping", async () => {
    const api = new MockApi().on("POST /tasks/v1/actions/list", { actions: [task("1"), task("2")], total: 2 });
    const { call, json } = await connect(api);
    const res = await call("sc_list_actions", { overdue_only: true });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    const data = json(res.text);
    expect(data.actions[0]).toMatchObject({ id: "1", status: "to_do", priority: "high", site: { name: "Demo Depot" } });
    expect(data.actions[0].overdue_days).toBeGreaterThan(0);
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_actions");
    expect(names).not.toContain("sc_create_action");
    expect(names).not.toContain("sc_delete_actions");
  });

  it("update sends one request per changed field and reports partial failure", async () => {
    const api = new MockApi()
      .on("PUT /tasks/v1/actions/a1/status", {})
      .on("PUT /tasks/v1/actions/a1/priority", () => new Response("nope", { status: 400 }));
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_update_action", { action_id: "a1", status: "complete", priority: "low" });
    expect(json(res.text)).toMatchObject({ changed: ["status"], failed: [{ field: "priority" }] });
    expect(api.calls.find((c) => c.path.endsWith("/status"))!.body).toEqual({ status_id: ACTION_STATUS.complete });
  });

  it("delete is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("^/tasks/v1/actions/[^/]+$", task("x"))
      .on("POST /tasks/v1/actions/delete", {});
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_delete_actions", { action_ids: ["x"] });
    expect(dry.text).toContain("DRY RUN");
    expect(api.calls.some((c) => c.path.endsWith("/delete"))).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;

    const wrong = await call("sc_delete_actions", { action_ids: ["x", "y"], confirm_token: token });
    expect(wrong.isError).toBe(true);

    const ok = await call("sc_delete_actions", { action_ids: ["x"], confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.path.endsWith("/delete"))).toHaveLength(1);

    const replay = await call("sc_delete_actions", { action_ids: ["x"], confirm_token: token });
    expect(replay.isError).toBe(true);
  });

  it("refuses a filterless bulk update", async () => {
    const { call } = await connect(new MockApi(), { SC_MODE: "full" });
    const res = await call("sc_bulk_update_actions", { filters: {}, set: { status: "complete" } });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Refusing/);
  });
});
