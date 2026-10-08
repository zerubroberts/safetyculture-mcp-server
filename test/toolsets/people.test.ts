import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const v1user = (id: string, extra: Record<string, unknown> = {}) => ({
  user_id: id,
  first_name: id === "user_1" ? "Alex" : "Sam",
  last_name: id === "user_1" ? "Demo" : "Sample",
  email: id === "user_1" ? "alex.demo@example.com" : "sam.sample@example.com",
  username: id === "user_1" ? "alexd" : "sams",
  status: "USER_ACTIVE_STATUS_ACTIVE",
  seat_type: "SUBSCRIPTION_SEAT_TYPE_PREMIUM",
  ...extra,
});

const legacyUser = (id: string) => ({
  user_id: id,
  firstname: "Alex",
  lastname: "Demo",
  email: "alex.demo@example.com",
  status: "active",
  seat_type: "full",
});

describe("people toolset", () => {
  it("searches users and matches text client-side", async () => {
    const api = new MockApi().on("POST /users/v1/users/list", { users: [v1user("user_1"), v1user("user_2")] });
    const { call, json } = await connect(api);
    const res = await call("sc_search_users", { text: "alex" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    expect(api.calls[0]!.body).toEqual({ page_size: 50, list_all: true });
    // The registry pseudonymises emails by default (email_<hmac>); the tool must not work around it.
    expect(json(res.text).users).toEqual([
      { id: "user_1", name: "Alex Demo", email: expect.stringMatching(/^email_[0-9a-f]{10}$/), active: true, seat_type: "premium" },
    ]);
  });

  it("filters by active status server-side", async () => {
    const api = new MockApi().on("POST /users/v1/users/list", { users: [] });
    const { call } = await connect(api);
    await call("sc_search_users", { active: false });
    expect(api.calls[0]!.body).toEqual({ page_size: 50, filters: { statuses: ["USER_ACTIVE_STATUS_DEACTIVATED"] } });
  });

  it("searches within a group via the group members endpoint", async () => {
    const api = new MockApi().on("GET /groups/group-1/users", { users: [legacyUser("user_1")], total: 1 });
    const { call, json } = await connect(api);
    const res = await call("sc_search_users", { group_id: "group-1", active: true });
    expect(api.calls[0]).toMatchObject({
      method: "GET",
      path: "/groups/group-1/users",
      query: { limit: "2000", status: "active" },
    });
    expect(json(res.text).users).toEqual([
      { id: "user_1", name: "Alex Demo", email: expect.stringMatching(/^email_[0-9a-f]{10}$/), active: true, seat_type: "full" },
    ]);
  });

  it("gets one user and errors when missing", async () => {
    const api = new MockApi().on("POST /users/v1/users/list", { users: [v1user("user_1")] });
    const { call, json } = await connect(api);
    const res = await call("sc_get_user", { user_id: "user_1" });
    expect(api.calls[0]!.body).toEqual({ filters: { user_ids: ["user_1"] } });
    expect(json(res.text)).toMatchObject({ id: "user_1", name: "Alex Demo", username: "alexd" });

    const missing = new MockApi().on("POST /users/v1/users/list", { users: [] });
    const gone = await (await connect(missing)).call("sc_get_user", { user_id: "user_9" });
    expect(gone.isError).toBe(true);
  });

  it("lists groups", async () => {
    const api = new MockApi().on("GET /groups", { groups: [{ id: "group-1", name: "Demo Crew" }] });
    const { call, json } = await connect(api);
    const res = await call("sc_list_groups", {});
    expect(json(res.text).groups).toEqual([{ id: "group-1", name: "Demo Crew" }]);
  });

  it("pages group members with offset tokens", async () => {
    const api = new MockApi().on("GET /groups/group-1/users", {
      users: [legacyUser("user_1")],
      total: 2,
      offset: 0,
      limit: 1,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_group_members", { group_id: "group-1", limit: 1 });
    expect(api.calls[0]).toMatchObject({ query: { limit: "1", offset: "0" } });
    expect(json(res.text)).toMatchObject({ total: 2, next_page_token: "1" });
    const res2 = await call("sc_list_group_members", { group_id: "group-1", limit: 1, page_token: "1" });
    expect(api.calls[1]).toMatchObject({ query: { offset: "1" } });
    expect(res2.isError).toBe(false);
  });

  it("lists permission sets with enabled permissions only", async () => {
    const api = new MockApi().on("POST /permissions/v1/permission_sets", {
      permission_sets: [
        {
          permission_set: {
            identifier: {
              id: "ps-1",
              type: "PERMISSION_SET_TYPE_CUSTOM",
              name: "Demo Leads",
              description: "Site leads",
              allowed_seat_types: ["SUBSCRIPTION_SEAT_TYPE_PREMIUM"],
            },
            modified_at: "2026-09-01T00:00:00Z",
            permissions: { manage_users: true, billing: false, view_assets: true },
          },
        },
      ],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_permission_sets", {});
    expect(api.calls[0]!.body).toEqual({ limit: 50, offset: 0 });
    expect(json(res.text).permission_sets).toEqual([
      {
        id: "ps-1",
        name: "Demo Leads",
        type: "custom",
        description: "Site leads",
        min_seat: "premium",
        enabled_permissions: ["manage_users", "view_assets"],
        modified_at: "2026-09-01T00:00:00Z",
      },
    ]);
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_search_users");
    expect(names).not.toContain("sc_add_user_to_group");
    expect(names).not.toContain("sc_remove_user_from_group");
  });

  it("adds a user to a group with the documented body", async () => {
    const api = new MockApi().on("POST /groups/group-1/users/v2", { users: ["user_1", "user_2"] });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_add_user_to_group", { group_id: "group-1", user_id: "user_2" });
    expect(api.calls[0]!.body).toEqual({ user_id: "user_2" });
    expect(json(res.text)).toMatchObject({ group_id: "group-1", user_id: "user_2", member_count: 2 });
  });

  it("remove is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET /groups/group-1/users", { users: [legacyUser("user_1")], total: 1 })
      .on("POST /users/v1/users/list", { users: [v1user("user_1")] })
      .on("DELETE /groups/group-1/users/user_1", { ok: true });
    const { call, json } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_remove_user_from_group", { group_id: "group-1", user_id: "user_1" });
    expect(dry.text).toContain("DRY RUN");
    expect(json(dry.text).user).toMatchObject({ id: "user_1", is_member: true });
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;
    const wrong = await call("sc_remove_user_from_group", { group_id: "group-1", user_id: "user_2", confirm_token: token });
    expect(wrong.isError).toBe(true);
    const ok = await call("sc_remove_user_from_group", { group_id: "group-1", user_id: "user_1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    const replay = await call("sc_remove_user_from_group", { group_id: "group-1", user_id: "user_1", confirm_token: token });
    expect(replay.isError).toBe(true);
  });
});
