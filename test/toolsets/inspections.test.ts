import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// All fixtures are synthetic: no real organisation data.
const feedRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Inspection ${id}`,
  archived: false,
  owner_id: "user_1",
  owner_name: "Alex Demo",
  site_id: "site-1",
  template_id: "template_1",
  template_name: "Demo Depot Checklist",
  score_percentage: 87.5,
  max_score: 40,
  date_completed: "2026-09-01T02:00:00Z",
  date_modified: "2026-09-02T02:00:00Z",
  ...extra,
});

const headerDetails = {
  inspection: {
    metadata: {
      inspection_id: "audit_1",
      inspection_name: "Demo Depot Walk",
      created_time: "2026-09-01T00:00:00Z",
      last_modified_time: "2026-09-02T00:00:00Z",
      last_modified_by: { id: "user_2", name: "Sam Demo" },
      completed_time: "2026-09-01T02:00:00Z",
      is_marked_as_complete: true,
      is_archived: false,
      score: { combined_score_percentage: 87.5, combined_score: 35, combined_max_score: 40 },
      site: { site_id: "site-1", site_name: "Demo Depot" },
      owner: { id: "user_1", name: "Alex Demo" },
    },
    template: { template_id: "template_1", template_name: "Demo Depot Checklist" },
  },
};

const answersDetails = {
  inspection: {
    items: [
      { item_id: "sec-1", type: "section", label: "Grounds" },
      {
        item_id: "q-1",
        type: "question",
        label: "Gate locked",
        parent_id: "sec-1",
        flagged: true,
        item_score: { score: 0, max_score: 5, score_percentage: 0 },
        question_item: { responses: [{ id: "r-no", value: "No" }], responseset_id: "rs-1" },
        attachments: { note: "Padlock missing" },
      },
      {
        item_id: "q-2",
        type: "text",
        label: "Notes",
        parent_id: "sec-1",
        flagged: false,
        text_item: { text: "All clear" },
      },
      {
        item_id: "rep-1",
        type: "repeated_section",
        label: "Fire extinguishers",
      },
      {
        item_id: "q-3",
        type: "checkbox",
        label: "Extinguisher charged",
        parent_id: "rep-1",
        flagged: false,
        checkbox_item: { checked: true },
        media_item: { media: [{ id: "m-1" }] },
      },
    ],
  },
};

describe("inspections toolset", () => {
  it("searches the feed with server-side filters and projects compact rows", async () => {
    const api = new MockApi().on("GET /feed/inspections", {
      data: [feedRow("audit_1"), feedRow("audit_2", { site_id: "site-2", owner_id: "user_9", owner_name: "Jo Demo" })],
      metadata: {},
    });
    const { call, json } = await connect(api);
    const res = await call("sc_search_inspections", { template_ids: ["template_1"], site_ids: ["site-1"], period: "2026-09-01..2026-09-30" });
    expect(res.isError).toBe(false);
    const q = api.calls[0]!;
    expect(q).toMatchObject({ method: "GET", path: "/feed/inspections" });
    expect(q.query).toMatchObject({ archived: "false", completed: "both", modified_after: "2026-09-01T00:00:00.000Z" });
    expect(q.query.template).toContain("template_1");
    const data = json(res.text);
    expect(data.total).toBe(1);
    expect(data.inspections[0]).toMatchObject({
      id: "audit_1",
      name: "Inspection audit_1",
      template: { id: "template_1", name: "Demo Depot Checklist" },
      site_id: "site-1",
      score_percentage: 87.5,
      completed_at: "2026-09-01T02:00:00Z",
      owner: "Alex Demo",
      link: "https://app.safetyculture.com/inspection/audit_1",
      report_link: "https://app.safetyculture.com/report/audit/audit_1",
    });
    expect(res.text).toContain("<untrusted-data>");
  });

  it("pages search results with page_token", async () => {
    const api = new MockApi().on("GET /feed/inspections", { data: [feedRow("audit_1"), feedRow("audit_2")], metadata: {} });
    const { call, json } = await connect(api);
    const first = json((await call("sc_search_inspections", { limit: 1 })).text);
    expect(first.inspections).toHaveLength(1);
    expect(first.next_page_token).toBe("1");
    const second = json((await call("sc_search_inspections", { limit: 1, page_token: "1" })).text);
    expect(second.inspections[0].id).toBe("audit_2");
    expect(second.next_page_token).toBeUndefined();
  });

  it("hides write and destructive tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_search_inspections");
    expect(names).toContain("sc_get_inspection");
    for (const w of ["sc_start_inspection", "sc_update_inspection", "sc_complete_inspection", "sc_clone_inspection", "sc_share_inspection", "sc_restore_inspection", "sc_archive_inspection", "sc_delete_inspection"]) {
      expect(names).not.toContain(w);
    }
  });

  it("gets one inspection header from details plus duration", async () => {
    const api = new MockApi()
      .on("GET /inspections/v1/inspections/audit_1/details", headerDetails)
      .on("GET /inspections/v1/inspections/audit_1", { inspection: { duration: 3600 } });
    const { call, json } = await connect(api);
    const res = await call("sc_get_inspection", { inspection_id: "audit_1" });
    expect(res.isError).toBe(false);
    expect(api.calls.map((c) => c.path)).toEqual([
      "/inspections/v1/inspections/audit_1/details",
      "/inspections/v1/inspections/audit_1",
    ]);
    expect(json(res.text)).toMatchObject({
      id: "audit_1",
      name: "Demo Depot Walk",
      template: { id: "template_1", name: "Demo Depot Checklist" },
      site: { id: "site-1", name: "Demo Depot" },
      owner: { id: "user_1", name: "Alex Demo" },
      author: "Sam Demo",
      score: { percentage: 87.5 },
      is_complete: true,
      archived: false,
      duration_seconds: 3600,
    });
  });

  it("flattens answers with section paths, failed flags and parent grouping", async () => {
    const api = new MockApi().on("GET /inspections/v1/inspections/audit_1/details", answersDetails);
    const { call, json } = await connect(api);
    const data = json((await call("sc_get_inspection_answers", { inspection_id: "audit_1" })).text);
    expect(data.total).toBe(3);
    expect(data.failed).toBe(1);
    expect(data.answers[0]).toMatchObject({
      item_id: "q-1",
      section: "Grounds",
      parent_id: "sec-1",
      label: "Gate locked",
      response: "No",
      failed: true,
      note: "Padlock missing",
    });
    // Repeated-section child keeps its parent id for grouping.
    expect(data.answers[2]).toMatchObject({ item_id: "q-3", section: "Fire extinguishers", parent_id: "rep-1", response: "Yes", media_count: 1 });
    const failedOnly = json((await call("sc_get_inspection_answers", { inspection_id: "audit_1", failed_only: true })).text);
    expect(failedOnly.total).toBe(1);
    expect(failedOnly.answers[0].item_id).toBe("q-1");
  });

  it("returns web report and deep links", async () => {
    const api = new MockApi()
      .on("GET /audits/audit_1/web_report_link", { url: "https://example.test/report/1" })
      .on("POST /audits/audit_1/deep_link", { url: "https://example.test/deep/1" });
    const { call, json } = await connect(api);
    const data = json((await call("sc_get_inspection_report_link", { inspection_id: "audit_1" })).text);
    expect(data).toMatchObject({ web_report_url: "https://example.test/report/1", deep_link: "https://example.test/deep/1" });
  });

  it("exports to PDF by default and Word on request", async () => {
    const api = new MockApi().on("POST /inspection/v1/export", { url: "https://example.test/doc.pdf", status: "STATUS_DONE" });
    const { call, json } = await connect(api);
    const pdf = json((await call("sc_export_inspection_document", { inspection_id: "audit_1" })).text);
    expect(pdf).toMatchObject({ status: "done", download_url: "https://example.test/doc.pdf" });
    expect(api.calls[0]).toMatchObject({
      method: "POST",
      path: "/inspection/v1/export",
      body: { export_data: [{ inspection_id: "audit_1" }], type: "DOCUMENT_TYPE_PDF" },
    });
    await call("sc_export_inspection_document", { inspection_id: "audit_1", format: "word" });
    expect(api.calls[1]!.body).toMatchObject({ type: "DOCUMENT_TYPE_WORD" });
  });

  it("lists media and resolves a download URL with the mapped media type", async () => {
    const api = new MockApi()
      .on("GET /inspections/v1/inspections/audit_1", { inspection: { media: [{ id: "m-1", filename: "gate.png", media_type: "MEDIA_TYPE_IMAGE" }] } })
      .on("GET /media/v1/download/m-1", { url: "https://example.test/m-1" });
    const { call, json } = await connect(api);
    const listed = json((await call("sc_list_inspection_media", { inspection_id: "audit_1" })).text);
    expect(listed.media).toEqual([{ id: "m-1", filename: "gate.png", media_type: "MEDIA_TYPE_IMAGE" }]);
    const got = json((await call("sc_get_media_url", { media_id: "m-1", token: "tok-1", media_type: "video" })).text);
    expect(got.url).toBe("https://example.test/m-1");
    expect(api.calls[1]).toMatchObject({
      method: "GET",
      path: "/media/v1/download/m-1",
      query: { token: "tok-1", media_type: "MEDIA_TYPE_VIDEO" },
    });
  });

  it("starts an inspection and assigns the site", async () => {
    const api = new MockApi()
      .on("POST /inspections/integration/v1/inspections", { inspection_identity: { inspection_id: "audit_9" } })
      .on("PUT /inspections/v1/inspections/audit_9/site", { inspection_id: "audit_9" });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const data = json((await call("sc_start_inspection", { template_id: "template_1", site_id: "site-1" })).text);
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/inspections/integration/v1/inspections", body: { template_id: "template_1" } });
    expect(api.calls[1]).toMatchObject({ method: "PUT", path: "/inspections/v1/inspections/audit_9/site", body: { site_id: "site-1" } });
    expect(data).toMatchObject({ id: "audit_9", site_set: true });
  });

  it("updates owner, site and answers with exact request bodies", async () => {
    const api = new MockApi()
      .on("PUT /inspections/v1/inspections/audit_1/owner", { inspection_id: "audit_1" })
      .on("PUT /inspections/v1/inspections/audit_1/site", { inspection_id: "audit_1" })
      .on("PUT /inspections/v1/inspections/audit_1", { inspection_id: "audit_1" });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const data = json(
      (
        await call("sc_update_inspection", {
          inspection_id: "audit_1",
          owner_id: "user_2",
          site_id: "site-2",
          answers: [
            { item_id: "q-1", type: "text", text: "Fixed" },
            { item_id: "q-2", type: "question", response_ids: ["r-yes"], note: "Verified" },
          ],
        })
      ).text,
    );
    expect(api.calls.find((c) => c.path.endsWith("/owner"))!.body).toEqual({ owner_id: "user_2" });
    expect(api.calls.find((c) => c.path.endsWith("/site"))!.body).toEqual({ site_id: "site-2" });
    expect(api.calls.find((c) => c.path === "/inspections/v1/inspections/audit_1")!.body).toEqual({
      items: [
        { item_id: "q-1", item_type: "ITEM_TYPE_TEXT", text_item: { value: "Fixed" } },
        { item_id: "q-2", item_type: "ITEM_TYPE_QUESTION", note: "Verified", question_item: { response_ids: ["r-yes"] } },
      ],
    });
    expect(data.changed).toEqual(["owner", "site", "answers(2)"]);
  });

  it("completes, clones, shares and restores with exact requests", async () => {
    const api = new MockApi()
      .on("POST /inspections/v1/inspections/audit_1/complete", { inspection_identity: { inspection_id: "audit_1" } })
      .on("POST /inspections/v1/inspections/audit_1/clone", { inspection_id: "audit_2" })
      .on("POST /audits/audit_1/share", {})
      .on("DELETE /inspections/v1/inspections/audit_1/archive", { inspection_id: "audit_1" });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    await call("sc_complete_inspection", { inspection_id: "audit_1" });
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/inspections/v1/inspections/audit_1/complete" });
    const cloned = json((await call("sc_clone_inspection", { inspection_id: "audit_1" })).text);
    expect(cloned.id).toBe("audit_2");
    await call("sc_share_inspection", { inspection_id: "audit_1", shares: [{ id: "user_2", permission: "view" }] });
    expect(api.calls[2]).toMatchObject({
      method: "POST",
      path: "/audits/audit_1/share",
      body: { shares: [{ id: "user_2", permission: "view" }] },
    });
    const restored = json((await call("sc_restore_inspection", { inspection_id: "audit_1" })).text);
    expect(restored.id).toBe("audit_1");
  });

  it("archive is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET /inspections/v1/inspections/audit_1/details", headerDetails)
      .on("GET /inspections/v1/inspections/audit_1", { inspection: {} })
      .on("POST /inspections/v1/inspections/audit_1/archive", { inspection_id: "audit_1" });
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_archive_inspection", { inspection_id: "audit_1" });
    expect(dry.text).toContain("DRY RUN");
    expect(dry.text).toContain("Demo Depot Walk");
    expect(api.calls.some((c) => c.path.endsWith("/archive") && c.method === "POST")).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;
    const wrong = await call("sc_archive_inspection", { inspection_id: "audit_2", confirm_token: token });
    expect(wrong.isError).toBe(true);
    const ok = await call("sc_archive_inspection", { inspection_id: "audit_1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.path.endsWith("/archive") && c.method === "POST")).toHaveLength(1);
  });

  it("delete is two-step and warns it is permanent", async () => {
    const api = new MockApi()
      .on("GET /inspections/v1/inspections/audit_1/details", headerDetails)
      .on("GET /inspections/v1/inspections/audit_1", { inspection: {} })
      .on("DELETE /inspections/v1/inspections/audit_1", { inspection_id: "audit_1" });
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_delete_inspection", { inspection_id: "audit_1" });
    expect(dry.text).toContain("DRY RUN");
    expect(dry.text).toMatch(/PERMANENTLY/);
    expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/inspections/v1/inspections/audit_1")).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;
    const ok = await call("sc_delete_inspection", { inspection_id: "audit_1", confirm_token: token });
    expect(ok.isError).toBe(false);
  });
});
