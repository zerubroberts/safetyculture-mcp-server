import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures are synthetic: no real organisation data.
const searchPage = {
  templates: [
    { template_id: "template_1", name: "Demo Depot Checklist", modified_at: "2026-09-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
    { template_id: "template_2", name: "Demo Forklift Check", modified_at: "2026-09-02T00:00:00Z", created_at: "2026-01-02T00:00:00Z" },
  ],
  count: 2,
  total: 2,
};

const definition = {
  template: {
    template_identity: { template_id: "template_1" },
    template_name: "Demo Depot Checklist",
    description: "Nightly walk",
    version: "v3",
    items: [
      { item_id: "sec-1", type: "ITEM_TYPE_SECTION", label: "Grounds" },
      {
        item_id: "q-1",
        type: "ITEM_TYPE_QUESTION",
        label: "Gate locked",
        parent_id: "sec-1",
        question_item: { response_set_id: "rs-local" },
      },
      { item_id: "q-2", type: "ITEM_TYPE_QUESTION", label: "Lights on", parent_id: "sec-1", question_item: { response_set_id: "rs-global" } },
      { item_id: "t-1", type: "ITEM_TYPE_TEXT", label: "Notes", parent_id: "sec-1" },
    ],
    response_sets: {
      template_response_sets: [{ response_set_id: "rs-local", responses: [{ id: "r-yes", label: "Yes" }, { id: "r-no", label: "No" }] }],
      global_response_sets: [{ response_set_id: "rs-global" }],
    },
  },
};

describe("templates toolset", () => {
  it("lists templates with name search and paging", async () => {
    const api = new MockApi().on("GET /templates/search", searchPage);
    const { call, json } = await connect(api);
    const res = await call("sc_list_templates", { name: "forklift" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/templates/search" });
    expect(api.calls[0]!.query).toMatchObject({ archived: "false", order: "desc", limit: "1000" });
    const data = json(res.text);
    expect(data.total).toBe(1);
    expect(data.templates[0]).toMatchObject({ id: "template_2", name: "Demo Forklift Check" });
    expect(res.text).toContain("<untrusted-data>");
  });

  it("pages the template list with page_token", async () => {
    const api = new MockApi().on("GET /templates/search", searchPage);
    const { call, json } = await connect(api);
    const first = json((await call("sc_list_templates", { limit: 1 })).text);
    expect(first.templates).toHaveLength(1);
    expect(first.next_page_token).toBe("1");
    const second = json((await call("sc_list_templates", { limit: 1, page_token: "1" })).text);
    expect(second.templates[0].id).toBe("template_2");
  });

  it("hides write and destructive tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_templates");
    expect(names).toContain("sc_get_template");
    expect(names).toContain("sc_list_response_sets");
    expect(names).not.toContain("sc_restore_template");
    expect(names).not.toContain("sc_archive_template");
  });

  it("gets a template with a compact question outline", async () => {
    const api = new MockApi().on("GET /templates/integration/v1/templates/template_1/definition", definition);
    const { call, json } = await connect(api);
    const data = json((await call("sc_get_template", { template_id: "template_1" })).text);
    expect(data).toMatchObject({ id: "template_1", name: "Demo Depot Checklist", question_count: 3 });
    expect(data.questions[0]).toMatchObject({
      item_id: "q-1",
      section: "Grounds",
      label: "Gate locked",
      type: "ITEM_TYPE_QUESTION",
      options: ["Yes", "No"],
    });
    // Global response sets are referenced by ID; the section container is skipped.
    expect(data.questions[1]).toMatchObject({ item_id: "q-2", global_response_set: "rs-global" });
    expect(data.questions.map((q: { item_id: string }) => q.item_id)).not.toContain("sec-1");
    expect(data.global_response_sets).toEqual(["rs-global"]);
  });

  it("caps a long outline with a note", async () => {
    const items = Array.from({ length: 105 }, (_, i) => ({ item_id: `q-${i}`, type: "ITEM_TYPE_TEXT", label: `Question ${i}` }));
    const api = new MockApi().on("GET /templates/integration/v1/templates/template_9/definition", {
      template: { template_identity: { template_id: "template_9" }, template_name: "Big Demo", items },
    });
    const { call, json } = await connect(api);
    const data = json((await call("sc_get_template", { template_id: "template_9" })).text);
    expect(data.question_count).toBe(105);
    expect(data.questions).toHaveLength(100);
    expect(data.outline_capped).toMatch(/100 of 105/);
  });

  it("lists and gets global response sets", async () => {
    const api = new MockApi()
      .on("GET /response_sets/v2", { response_sets: [{ responseset_id: "rs-1", name: "Yes No", created_at: "2026-01-01T00:00:00Z" }] })
      .on("GET /response_sets/rs-1", {
        responseset_id: "rs-1",
        name: "Yes No",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-02-01T00:00:00Z",
        responses: [
          { id: "r-yes", label: "Yes", short_label: "Y" },
          { id: "r-no", label: "No", short_label: "N" },
        ],
      });
    const { call, json } = await connect(api);
    const listed = json((await call("sc_list_response_sets", {})).text);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/response_sets/v2" });
    expect(listed.response_sets).toEqual([{ id: "rs-1", name: "Yes No", created_at: "2026-01-01T00:00:00Z" }]);
    const got = json((await call("sc_get_response_set", { response_set_id: "rs-1" })).text);
    expect(got.responses).toEqual([
      { id: "r-yes", label: "Yes", short_label: "Y" },
      { id: "r-no", label: "No", short_label: "N" },
    ]);
  });

  it("restores an archived template", async () => {
    const api = new MockApi().on("DELETE /templates/v1/templates/template_1/archive", {});
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const data = json((await call("sc_restore_template", { template_id: "template_1" })).text);
    expect(api.calls[0]).toMatchObject({ method: "DELETE", path: "/templates/v1/templates/template_1/archive" });
    expect(data.id).toBe("template_1");
  });

  it("archive is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET /templates/integration/v1/templates/template_1/definition", definition)
      .on("POST /templates/v1/templates/template_1/archive", {});
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_archive_template", { template_id: "template_1" });
    expect(dry.text).toContain("DRY RUN");
    expect(dry.text).toContain("Demo Depot Checklist");
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;
    const wrong = await call("sc_archive_template", { template_id: "template_2", confirm_token: token });
    expect(wrong.isError).toBe(true);
    const ok = await call("sc_archive_template", { template_id: "template_1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });
  it("reads past the 1,000-row search cap using modified_before windows", async () => {
    // Synthetic: 1,200 templates, newest first, one minute apart.
    const all = Array.from({ length: 1200 }, (_, i) => ({
      template_id: `template_${i}`,
      name: i === 1199 ? "Demo Oldest Audit" : `Demo Template ${i}`,
      modified_at: new Date(Date.UTC(2026, 8, 1) - i * 60_000).toISOString(),
      created_at: "2026-01-01T00:00:00Z",
    }));
    const api = new MockApi().on("GET /templates/search", (req: { query: Record<string, string> }) => {
      const rows = req.query.modified_before ? all.filter((t) => t.modified_at < req.query.modified_before!) : all;
      const page = rows.slice(0, Number(req.query.limit));
      return { templates: page, count: page.length, total: rows.length };
    });
    const { call, json } = await connect(api);
    const data = json((await call("sc_list_templates", { name: "oldest" })).text);
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1]!.query.modified_before).toBe(all[999]!.modified_at);
    expect(data.templates.map((t: { id: string }) => t.id)).toEqual(["template_1199"]);
    expect(data.truncated).toBeUndefined();
    const listed = json((await call("sc_list_templates", { limit: 1 })).text);
    expect(listed.total).toBe(1200);
  });

  it("flags the list as truncated when total exceeds what could be read", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ template_id: `template_${i}`, name: `Demo Template ${i}`, modified_at: "2026-09-01T00:00:00.000Z" }));
    const api = new MockApi().on("GET /templates/search", (req: { query: Record<string, string> }) =>
      req.query.modified_before ? { templates: [], count: 0, total: 0 } : { templates: rows, count: 1000, total: 1500 },
    );
    const { call, json } = await connect(api);
    const res = await call("sc_list_templates", { name: "nothing-matches" });
    const data = json(res.text);
    expect(data.total).toBe(0);
    expect(data.truncated).toBe(true);
    expect(res.text).toContain("Only 1000 of 1500 templates could be read");
  });
});
