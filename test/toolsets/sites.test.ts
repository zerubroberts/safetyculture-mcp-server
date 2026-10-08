import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const entry = (id: string, name: string, ancestors: Array<{ id: string; name: string; meta_label: string }> = []) => ({
  folder: { id, name, meta_label: "location", members_count: 3 },
  ancestors,
  members_count: 3,
  has_children: false,
});

describe("sites toolset", () => {
  it("lists sites with parent id and level label", async () => {
    const api = new MockApi().on("POST /directory/v1/folders/search", {
      folders: [entry("site-1", "Demo Depot", [{ id: "site-0", name: "Demo Region", meta_label: "region" }])],
      folder_count: 1,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_sites", { text: "Depot" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    expect(api.calls[0]!.body).toEqual({ query: "Depot", limit: 50 });
    expect(json(res.text).sites).toEqual([
      {
        id: "site-1",
        name: "Demo Depot",
        parent_id: "site-0",
        parent_name: "Demo Region",
        level: "location",
        path: "Demo Region / Demo Depot",
        has_children: false,
        members_count: 3,
      },
    ]);
  });

  it("gets one site with path and counts", async () => {
    const api = new MockApi().on("GET ^/directory/v1/folder/[^/]+$", {
      folder: { id: "site-1", name: "Demo Depot", meta_label: "location" },
      ancestors: [{ id: "site-0", name: "Demo Region", meta_label: "region" }],
      all_children_count: 2,
      member_count: 3,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_site", { site_id: "site-1" });
    expect(api.calls[0]).toMatchObject({
      method: "GET",
      path: "/directory/v1/folder/site-1",
      query: { with_ancestors: "true", with_all_children_count: "true" },
    });
    expect(json(res.text)).toMatchObject({
      id: "site-1",
      path: "Demo Region / Demo Depot",
      members_count: 3,
      children_count: 2,
    });
  });

  it("builds a nested tree below a site, capped by depth", async () => {
    const child = (id: string, name: string, has_children: boolean) => ({
      folder: { id, name, meta_label: "location" },
      has_children,
      children_count: has_children ? 1 : 0,
    });
    const api = new MockApi()
      .on("GET ^/directory/v1/folder/[^/]+$", { folder: { id: "site-0", name: "Demo Region", meta_label: "region" } })
      .on("GET /directory/v1/parent/site-0/folders", { folders: [child("site-1", "Demo Depot", true)] })
      .on("GET /directory/v1/parent/site-1/folders", { folders: [child("site-2", "Demo Yard", false)] });
    const { call, json } = await connect(api);
    const res = await call("sc_site_tree", { site_id: "site-0", depth: 2 });
    const roots = json(res.text).roots;
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0]).toMatchObject({ id: "site-1", children: [{ id: "site-2" }] });
    expect(api.calls.filter((c) => c.path.startsWith("/directory/v1/parent/"))).toHaveLength(2);
  });

  it("discovers top-level sites when no site is given", async () => {
    const api = new MockApi()
      .on("POST /directory/v1/folders/search", {
        folders: [entry("site-0", "Demo Region"), entry("site-1", "Demo Depot", [{ id: "site-0", name: "Demo Region", meta_label: "region" }])],
      })
      .on("GET /directory/v1/parent/site-0/folders", { folders: [] });
    const { call, json } = await connect(api);
    const res = await call("sc_site_tree", { depth: 1 });
    expect(json(res.text).roots.map((r: { id: string }) => r.id)).toEqual(["site-0"]);
  });

  it("lists members and resolves their details", async () => {
    const api = new MockApi()
      .on("GET ^/directory/v1/folder/[^/]+/users$", { user_ids: ["user_1", "user_2"] })
      .on("POST /users/v1/users/list", {
        users: [
          { user_id: "user_1", first_name: "Alex", last_name: "Demo", email: "alex.demo@example.com", status: "USER_ACTIVE_STATUS_ACTIVE", seat_type: "SUBSCRIPTION_SEAT_TYPE_PREMIUM" },
          { user_id: "user_2", first_name: "Sam", last_name: "Sample", email: "sam.sample@example.com", status: "USER_ACTIVE_STATUS_DEACTIVATED", seat_type: "SUBSCRIPTION_SEAT_TYPE_LITE" },
        ],
      });
    const { call, json } = await connect(api);
    const res = await call("sc_list_site_members", { site_id: "site-1" });
    expect(api.calls[0]!.path).toBe("/directory/v1/folder/site-1/users");
    expect(api.calls[1]!.body).toEqual({ filters: { user_ids: ["user_1", "user_2"] } });
    expect(json(res.text)).toMatchObject({
      total: 2,
      members: [
        { id: "user_1", name: "Alex Demo", active: true, seat_type: "premium" },
        { id: "user_2", active: false },
      ],
    });
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_sites");
    expect(names).not.toContain("sc_create_site");
    expect(names).not.toContain("sc_add_site_members");
  });

  it("creates a site with the documented body", async () => {
    const api = new MockApi().on("POST /directory/v1/folder", {
      folder: { id: "site-9", name: "Demo Yard", meta_label: "area" },
    });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_create_site", { name: "Demo Yard", parent_id: "site-0", level: "area" });
    expect(api.calls[0]!.body).toEqual({ name: "Demo Yard", parent_id: "site-0", meta_label: "area" });
    expect(json(res.text)).toEqual({ id: "site-9", name: "Demo Yard", level: "area" });
  });

  it("adds members with the documented assignments body", async () => {
    const api = new MockApi().on("POST /directory/v1/users/folders/membership", {
      assignments: { "site-1": { user_1: "added" } },
    });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_add_site_members", { site_id: "site-1", user_ids: ["user_1", "user_2"] });
    expect(api.calls[0]!.body).toEqual({ assignments: { "site-1": { user_ids: ["user_1", "user_2"] } } });
    expect(json(res.text)).toMatchObject({ site_id: "site-1", user_ids: ["user_1", "user_2"] });
  });
});
