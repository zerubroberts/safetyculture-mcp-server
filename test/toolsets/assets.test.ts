import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const asset = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  code: `ASSET-${id}`,
  type: { name: "Demo Forklift", type_id: "type-1" },
  fields: [{ field_id: "field-1", name: "Serial", string_value: "SN-1" }],
  site: { id: "site-1", name: "Demo Depot" },
  state: "ASSET_STATE_ACTIVE",
  inspected_at: "2026-09-01T00:00:00Z",
  statuses: [{ name: "In service" }],
  ...extra,
});

describe("assets toolset", () => {
  it("lists assets with AND-ed filters and compact rows", async () => {
    const api = new MockApi().on("POST /assets/v1/assets/list", { assets: [asset("a1"), asset("a2")] });
    const { call, json } = await connect(api);
    const res = await call("sc_list_assets", { type_id: "type-1", site_id: "site-1", state: "active", text: "Fork" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    expect(api.calls[0]!.body).toEqual({
      page_size: 50,
      search: "Fork",
      asset_filters: [{ type_id: "type-1" }, { site_id: "site-1" }, { state: "ASSET_STATE_ACTIVE" }],
    });
    expect(json(res.text).assets[0]).toMatchObject({
      id: "a1",
      code: "ASSET-a1",
      type: "Demo Forklift",
      site: { id: "site-1", name: "Demo Depot" },
      state: "active",
      status: "In service",
    });
  });

  it("gets one asset with flattened field values", async () => {
    const api = new MockApi().on("GET ^/assets/v1/assets/[^/]+$", {
      asset: asset("a1", {
        fields: [
          { field_id: "field-1", name: "Serial", string_value: "SN-1" },
          { name: "Price", money_value: { currency_code: "AUD", units: "1500", nanos: 500000000 } },
        ],
        media: [{ id: "m1" }, { id: "m2" }],
      }),
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_asset", { asset_id: "a1" });
    expect(json(res.text)).toMatchObject({
      id: "a1",
      fields: [
        { id: "field-1", name: "Serial", value: "SN-1" },
        { name: "Price", value: "AUD 1500.5" },
      ],
      media_count: 2,
    });
  });

  it("finds by exact code with a query parameter", async () => {
    const api = new MockApi().on("GET /assets/v1/assets:GetAssetByCode", { asset: asset("a9") });
    const { call, json } = await connect(api);
    const res = await call("sc_find_asset", { code: "ASSET-9" });
    expect(api.calls[0]).toMatchObject({ method: "GET", query: { code: "ASSET-9" } });
    expect(json(res.text).code).toBe("ASSET-a9");
  });

  it("finds by field value and rejects ambiguous input", async () => {
    const api = new MockApi().on("POST /assets/v1/assets:LookupAssetsByField", { assets: [asset("a3")] });
    const { call, json } = await connect(api);
    const res = await call("sc_find_asset", { field_name: "Serial", field_value: "SN-1" });
    expect(api.calls[0]!.body).toEqual({ field_name: "Serial", string_value: "SN-1", page_size: 50 });
    expect(json(res.text).assets).toHaveLength(1);
    expect((await call("sc_find_asset", { code: "x", field_name: "Serial", field_value: "SN-1" })).isError).toBe(true);
    expect((await call("sc_find_asset", {})).isError).toBe(true);
  });

  it("lists types and fields", async () => {
    const api = new MockApi()
      .on("POST /assets/v1/types/list", {
        type_list: [{ id: "type-1", name: "Demo Forklift", type: "TYPE_CATEGORY_CUSTOM" }],
      })
      .on("POST /assets/v1/fields/list", {
        result: [{ id: "field-1", name: "Serial", field_type: "FIELD_TYPE_CUSTOM", value_type: "FIELD_VALUE_TYPE_STRING" }],
      });
    const { call, json } = await connect(api);
    const types = await call("sc_list_asset_types", {});
    expect(api.calls[0]!.body).toEqual({ page_size: 50 });
    expect(json(types.text).types).toEqual([{ id: "type-1", name: "Demo Forklift", category: "custom" }]);
    const fields = await call("sc_list_asset_fields", {});
    expect(json(fields.text).fields[0]).toMatchObject({ id: "field-1", value_type: "string" });
  });

  it("lists maintenance programs and status counts", async () => {
    const api = new MockApi()
      .on("POST /assets/v1/maintenance/program/details", {
        program_details: [{ program: { id: "prog-1", name: "Demo servicing", description: "Quarterly" }, assets_count: 4, plans_count: 2 }],
      })
      .on("POST /assets/v1/maintenance/assets/status-counts", {
        scheduled_count: 1,
        due_soon_count: 2,
        overdue_count: 3,
        data_missing_count: 0,
      });
    const { call, json } = await connect(api);
    const progs = await call("sc_list_maintenance_programs", {});
    expect(json(progs.text).programs).toEqual([
      { id: "prog-1", name: "Demo servicing", description: "Quarterly", assets_count: 4, plans_count: 2 },
    ]);
    const counts = await call("sc_maintenance_status_counts", { program_id: "prog-1" });
    expect(api.calls[1]!.body).toEqual({ filter: { program_ids: ["prog-1"] } });
    expect(json(counts.text)).toMatchObject({ overdue: 3, due_soon: 2, total: 6 });
  });

  it("gets maintenance details plus service history", async () => {
    const api = new MockApi()
      .on("POST /assets/v1/maintenance/assets/details", {
        details: [
          {
            program_summary: { id: "prog-1", name: "Demo servicing" },
            plan_summary: { id: "plan-1", name: "Quarterly check" },
            service_status: "ASSET_SERVICE_STATUS_OVERDUE",
            last_service: { unit_value: { value: 100, unit: "h" } },
            last_service_timestamp: "2026-06-01T00:00:00Z",
            open_action_count: 1,
          },
        ],
      })
      .on("POST /assets/v1/maintenance/asset/a1/service-history", {
        history: [{ service_date: "2026-06-01T00:00:00Z", service_value: { unit_value: { value: 100, unit: "h" } }, user: { name: "Alex Demo" } }],
      });
    const { call, json } = await connect(api);
    const res = await call("sc_get_asset_maintenance", { asset_id: "a1" });
    expect(api.calls[0]!.body).toEqual({ filter: { asset_ids: ["a1"] } });
    expect(api.calls[1]!.body).toEqual({ plan_id: "plan-1", page_size: 5 });
    expect(json(res.text).plans[0]).toMatchObject({
      program: "Demo servicing",
      plan: "Quarterly check",
      status: "overdue",
      last_service: { value: 100, unit: "h", at: "2026-06-01T00:00:00Z" },
      recent_service: [{ at: "2026-06-01T00:00:00Z", value: 100, unit: "h", by: "Alex Demo" }],
    });
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_assets");
    expect(names).not.toContain("sc_create_asset");
    expect(names).not.toContain("sc_update_asset");
    expect(names).not.toContain("sc_archive_asset");
  });

  it("creates an asset with the documented body", async () => {
    const api = new MockApi().on("POST /assets/v1/assets", { id: "asset-9" });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_create_asset", {
      type_id: "type-1",
      code: "DEMO-9",
      site_id: "site-1",
      fields: [{ field_id: "field-1", value: "SN-9" }],
    });
    expect(api.calls[0]!.body).toEqual({
      type_id: "type-1",
      code: "DEMO-9",
      site: "site-1",
      fields: [{ field_id: "field-1", string_value: "SN-9" }],
    });
    expect(json(res.text)).toEqual({ id: "asset-9" });
  });

  it("updates one group per call and reports partial failure", async () => {
    const api = new MockApi()
      .on("PATCH /assets/v1/assets/a1", {})
      .on("PATCH /assets/v1/assets/a1/fields", () => new Response("nope", { status: 400 }));
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_update_asset", { asset_id: "a1", code: "DEMO-X", field_values: [{ name: "Serial", value: "SN-X" }] });
    expect(api.calls.find((c) => c.path === "/assets/v1/assets/a1")!.body).toEqual({ code: "DEMO-X" });
    expect(api.calls.find((c) => c.path === "/assets/v1/assets/a1/fields")!.body).toEqual({
      fields: [{ name: "Serial", string_value: "SN-X" }],
    });
    expect(json(res.text)).toMatchObject({ changed: ["code"], failed: [{ field: "field_values" }] });
  });

  it("archive is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET ^/assets/v1/assets/[^/]+$", { asset: asset("a1") })
      .on("PATCH /assets/v1/assets/a1/archive", { id: "a1" });
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_archive_asset", { asset_id: "a1" });
    expect(dry.text).toContain("DRY RUN");
    expect(api.calls.some((c) => c.path.endsWith("/archive"))).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;
    const wrong = await call("sc_archive_asset", { asset_id: "a2", confirm_token: token });
    expect(wrong.isError).toBe(true);
    const ok = await call("sc_archive_asset", { asset_id: "a1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.path.endsWith("/archive"))).toHaveLength(1);
    const replay = await call("sc_archive_asset", { asset_id: "a1", confirm_token: token });
    expect(replay.isError).toBe(true);
  });
});
