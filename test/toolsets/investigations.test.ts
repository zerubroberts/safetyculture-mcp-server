import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const mkInv = (id: string) => ({
  investigation_id: id,
  created_at: "2026-09-01T00:00:00.000Z",
  modified_at: "2026-09-02T00:00:00.000Z",
  title: `Demo investigation ${id}`,
  description: `Demo description ${id}`,
  status: { status_id: "st-1", title_localised: { value: "Open" } },
  identifier: { prefix: "IM", sequence: 7, for_display: "IM-7" },
  creator: { user_id: "user_1", display_name: "Alex Demo" },
  owner: { user_id: "user_2", display_name: "Sam Demo" },
  category: { category_id: "cat-1", title: "Safety" },
  link_counts: { total_actions: 2, open_actions: 1, closed_actions: 1 },
  fields: [{ field_id: "f-1", title: "Root cause", text: { text: "Demo cause" } }],
});

const mkCase = (extra: Record<string, unknown> = {}) => ({
  case_id: "case-1",
  establishment_id: "est-1",
  created_at: "2026-09-01T00:00:00.000Z",
  modified_at: "2026-09-02T00:00:00.000Z",
  year_of_filing: 2026,
  case_number: "C-1",
  job_title: "Demo driver",
  date_of_incident: "2026-08-15T00:00:00.000Z",
  incident_location: "Demo Depot",
  incident_outcome: 2,
  type_of_incident: 1,
  dafw_num_away: 3,
  djtr_num_tr: 0,
  nar_before_incident: "Demo narrative",
  nar_what_happened: "Demo event",
  nar_injury_illness: "Demo injury",
  nar_object_substance: "Demo object",
  employee_name: "Alex Demo",
  ...extra,
});

describe("investigations toolset", () => {
  it("lists investigations with query filters and compact rows", async () => {
    const api = new MockApi().on("GET /incidents/v1/investigations", { results: [mkInv("inv-1")], next_page_token: "tok" });
    const { call, json } = await connect(api);
    const res = await call("sc_list_investigations", { search: "demo", status_ids: ["st-1"], sort: "created" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    const q = api.calls[0]!.query;
    expect(q).toMatchObject({
      search: "demo",
      "filters.status_ids.values": "st-1",
      "sort.field": "InvestigationsSortFieldCreatedAt",
      page_size: "50",
    });
    expect(json(res.text).investigations).toEqual([
      {
        id: "inv-1",
        ref: "IM-7",
        title: "Demo investigation inv-1",
        status: "Open",
        category: { id: "cat-1", title: "Safety" },
        created_at: "2026-09-01T00:00:00.000Z",
        modified_at: "2026-09-02T00:00:00.000Z",
        creator: "Alex Demo",
        owner: "Sam Demo",
      },
    ]);
  });

  it("gets one investigation with counts and linked lists", async () => {
    const base = "/incidents/v1/investigations/inv-1";
    const api = new MockApi()
      .on(`GET ${base}`, { investigation: mkInv("inv-1") })
      .on(`GET ${base}/actions/count`, { count: 2 })
      .on(`GET ${base}/inspections/count`, { count: 1 })
      .on(`GET ${base}/issues/count`, { count: 1 })
      .on(`GET ${base}/media/count`, { count: 1 })
      .on(`GET ${base}/actions`, { actions: [{ action: { task: { task_id: "a-1", unique_id: "A-a-1", title: "Demo action" } } }] })
      .on(`GET ${base}/inspections`, { inspections: [{ inspection: { id: "audit_1", name: "Demo inspection", completed: true, archived: false } }] })
      .on(`GET ${base}/issues`, { issues: [{ issue: { task: { task_id: "i-1", unique_id: "IS-i-1", title: "Demo issue" } } }] })
      .on(`GET ${base}/media`, { media: [{ file: { id: "m-1", filename: "demo.jpg" }, uploaded_at: "2026-09-03T00:00:00.000Z", uploaded_by: { display_name: "Alex Demo" } }] });
    const { call, json } = await connect(api);
    const res = await call("sc_get_investigation", { investigation_id: "inv-1" });
    expect(res.isError).toBe(false);
    const data = json(res.text);
    expect(data.counts).toEqual({ actions: 2, inspections: 1, issues: 1, media: 1 });
    expect(data.custom_fields).toEqual([{ id: "f-1", title: "Root cause", text: "Demo cause" }]);
    expect(data.linked_actions).toEqual([{ id: "a-1", ref: "A-a-1", title: "Demo action" }]);
    expect(data.linked_inspections).toEqual([{ id: "audit_1", name: "Demo inspection", completed: true, archived: false }]);
    expect(data.linked_issues).toEqual([{ id: "i-1", ref: "IS-i-1", title: "Demo issue" }]);
    expect(data.linked_media).toEqual([{ id: "m-1", filename: "demo.jpg", uploaded_at: "2026-09-03T00:00:00.000Z", uploaded_by: "Alex Demo" }]);
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_investigations");
    expect(names).toContain("sc_get_osha_case");
    expect(names).not.toContain("sc_create_investigation");
    expect(names).not.toContain("sc_update_investigation");
  });

  it("creates an investigation with category and originating issue", async () => {
    const api = new MockApi().on("POST /incidents/v1/investigations", { result: { investigation_id: "inv-9" } });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_create_investigation", { title: "Demo spill probe", category_id: "cat-1", issue_id: "iss-1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toEqual({
      title: "Demo spill probe",
      category_id: "cat-1",
      initial_status_id: undefined,
      originated_from: [{ issue_id: "iss-1" }],
    });
    expect(json(res.text)).toEqual({ id: "inv-9" });
  });

  it("update sends one operation per field and reports partial failure", async () => {
    const api = new MockApi().on("PUT /incidents/v1/investigations/inv-9", (req: { body: { operation?: Record<string, unknown> } }) =>
      req.body.operation && "set_status" in req.body.operation ? new Response("nope", { status: 400 }) : {},
    );
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_update_investigation", { investigation_id: "inv-9", title: "Demo retitled", status_id: "st-9", link_issue_ids: ["iss-1"] });
    expect(res.isError).toBe(false);
    expect(json(res.text)).toMatchObject({ changed: ["title", "link_issues"], failed: [{ field: "status" }] });
    const bodies = api.calls.map((c) => c.body);
    expect(bodies).toContainEqual({ operation: { set_title: { title: "Demo retitled" } } });
    expect(bodies).toContainEqual({ operation: { link_issues: { issue_ids: ["iss-1"] } } });
  });

  it("lists OSHA cases as minimal projections without medical free text", async () => {
    const api = new MockApi().on("GET /incidents/v1/osha/cases", { results: [mkCase()], next_page_token: "tok" });
    const { call, json } = await connect(api);
    const res = await call("sc_list_osha_cases", { year_of_filing: 2026 });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.query).toMatchObject({ year_of_filing: "2026", page_size: "50" });
    const data = json(res.text);
    expect(data.cases).toHaveLength(1);
    expect(data.cases[0]).toMatchObject({ case_id: "case-1", case_number: "C-1", outcome: "days_away", incident_type: "injury", days_away: 3 });
    expect(data.cases[0]).not.toHaveProperty("nar_what_happened");
    expect(data.cases[0]).not.toHaveProperty("employee_name");
  });

  it("gets an OSHA case minimally by default and fully with include_details", async () => {
    const api = new MockApi().on("GET /incidents/v1/osha/cases/case-1", { case: mkCase() });
    const { call, json } = await connect(api);
    const minimal = await call("sc_get_osha_case", { case_id: "case-1" });
    expect(minimal.isError).toBe(false);
    expect(json(minimal.text)).not.toHaveProperty("details");

    const full = await call("sc_get_osha_case", { case_id: "case-1", include_details: true });
    expect(full.isError).toBe(false);
    const data = json(full.text);
    expect(data.details.narrative).toMatchObject({ what_happened: "Demo event", injury_illness: "Demo injury" });
    expect(data.details.employee).toMatchObject({ name: "Alex Demo" });
  });

  it("lists OSHA establishments minimally", async () => {
    const api = new MockApi().on("GET /incidents/v1/osha/establishments", {
      results: [{ establishment_id: "est-1", establishment_name: "Demo Depot", company_name: "Demo Co", city: "Demo City", state: "DS" }],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_osha_establishments", { search: "demo" });
    expect(res.isError).toBe(false);
    expect(json(res.text).establishments).toEqual([{ establishment_id: "est-1", name: "Demo Depot", company: "Demo Co", city: "Demo City", state: "DS" }]);
  });
});
