import { describe, expect, it } from "vitest";
import { buildIssueFilters, ISSUE_PRIORITY, ISSUE_STATUS } from "../../src/toolsets/issues.js";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const mkIncident = (id: string, extra: Record<string, unknown> = {}) => ({
  task: {
    task_id: id,
    unique_id: `IS-${id}`,
    title: `Demo issue ${id}`,
    description: `Demo description ${id}`,
    status_id: ISSUE_STATUS.open,
    priority_id: ISSUE_PRIORITY.high,
    created_at: "2026-09-01T00:00:00.000Z",
    occurred_at: "2026-08-31T00:00:00.000Z",
    due_at: "2026-10-31T00:00:00.000Z",
    collaborators: [{ assigned_role: "ASSIGNEE", user: { user_id: "user_1", firstname: "Alex", lastname: "Demo" } }],
    site: { id: "site-1", name: "Demo Depot" },
    inspection: { inspection_id: "audit_abc", inspection_name: "Demo inspection" },
    creator: { user_id: "user_2", firstname: "Sam", lastname: "Demo" },
  },
  category: { id: "cat-1", key: "safety", label: "Safety" },
  inspections: [{ id: "audit_abc", status: "COMPLETED", title: "Demo inspection", template_title: "Demo template" }],
  ...extra,
});

describe("issues toolset", () => {
  it("builds flat duration filters with friendly status/priority IDs", () => {
    const f = buildIssueFilters(
      { status: ["open"], priority: ["high"], category_ids: ["c1"], site_ids: ["s1"], assignee_ids: ["u1"], period: "2026-01-01..2026-01-31" },
      new Date("2026-10-08T00:00:00Z"),
    );
    expect(f).toContainEqual({ status_id: { value: [ISSUE_STATUS.open] } });
    expect(f).toContainEqual({ priority_id: { value: [ISSUE_PRIORITY.high] } });
    expect(f).toContainEqual({ category_id: { value: ["c1"] } });
    expect(f).toContainEqual({ site_id: { value: ["s1"] } });
    expect(f).toContainEqual({ assignee_id: { value: ["u1"] } });
    expect(f).toContainEqual({ created_at: { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" } });
  });

  it("filters the period on occurred_at when asked", () => {
    const f = buildIssueFilters({ period: "2026-01-01..2026-01-31", period_on: "occurred" }, new Date("2026-10-08T00:00:00Z"));
    expect(f).toContainEqual({ occurred_at: { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z" } });
  });

  it("lists issues as compact rows with counts and untrusted wrapping", async () => {
    const api = new MockApi().on("POST /tasks/v1/incidents/list", { incidents: [mkIncident("1"), mkIncident("2")], total: 2 });
    const { call, json } = await connect(api);
    const res = await call("sc_list_issues", { status: ["open"] });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    const listCall = api.calls.find((c) => c.path === "/tasks/v1/incidents/list")!;
    expect(listCall.body).toMatchObject({
      sort_field: "MODIFIED_AT",
      sort_direction: "DESC",
      filters: [{ status_id: { value: [ISSUE_STATUS.open] } }],
    });
    const data = json(res.text);
    expect(data.total).toBe(2);
    expect(data.by_status).toContainEqual({ value: "open", count: 2 });
    expect(data.by_category).toContainEqual({ value: "Safety", count: 2 });
    expect(data.issues[0]).toMatchObject({
      id: "1",
      ref: "IS-1",
      title: "Demo issue 1",
      category: { id: "cat-1", name: "Safety" },
      status: "open",
      priority: "high",
      site: { name: "Demo Depot" },
      link: "https://app.safetyculture.com/issues/1",
    });
  });

  it("gets one issue with questions, answers and the linked inspection", async () => {
    const api = new MockApi()
      .on("GET /tasks/v1/incident/i1", { incident: mkIncident("i1") })
      .on("GET /tasks/v1/incidents/i1/questions_answers", {
        questions_answers: [
          {
            question: { id: "q-1", text: "What happened?" },
            is_answered: true,
            answer_set: [{ answer_text: { text: "Demo answer" }, answered_at: "2026-09-02T00:00:00.000Z" }],
          },
        ],
      });
    const { call, json } = await connect(api);
    const res = await call("sc_get_issue", { issue_id: "i1" });
    expect(res.isError).toBe(false);
    const data = json(res.text);
    expect(data).toMatchObject({ id: "i1", description: "Demo description i1" });
    expect(data.inspection).toMatchObject({ id: "audit_abc", name: "Demo inspection" });
    expect(data.linked_inspections[0]).toMatchObject({ id: "audit_abc", title: "Demo inspection" });
    expect(data.questions_answers).toEqual([{ question: "What happened?", answered: true, answers: ["Demo answer"] }]);
  });

  it("counts issues with the list filters", async () => {
    const api = new MockApi().on("POST /tasks/v1/incidents/list/count", { total: 7 });
    const { call, json } = await connect(api);
    const res = await call("sc_count_issues", { priority: ["high"] });
    expect(res.isError).toBe(false);
    expect(json(res.text)).toEqual({ total: 7 });
    expect(api.calls[0]!.body).toEqual({ filters: [{ priority_id: { value: [ISSUE_PRIORITY.high] } }] });
  });

  it("lists issue categories compactly", async () => {
    const api = new MockApi().on("GET /tasks/v1/customerconfiguration/categories", {
      categories: [{ id: "cat-1", key: "safety", label: "Safety", description: "Demo category" }],
      total: 1,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_issue_categories", {});
    expect(res.isError).toBe(false);
    expect(json(res.text).categories).toEqual([{ id: "cat-1", name: "Safety", description: "Demo category" }]);
  });

  it("returns the timeline with comment text extracted", async () => {
    const api = new MockApi().on("POST /tasks/v1/timeline", {
      timeline_items: [
        { item_id: "t-1", item_type: "TASK_COMMENT_ADDED", timestamp: "2026-09-02T00:00:00Z", creator: { firstname: "Alex", lastname: "Demo" }, task_comment_added_data: { comment: "Demo comment" } },
        { item_id: "t-2", item_type: "TASK_STATUS_UPDATED", timestamp: "2026-09-03T00:00:00Z", task_status_updated_data: { status_id: ISSUE_STATUS.resolved } },
      ],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_issue_timeline", { issue_id: "i1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toEqual({ task_id: "i1" });
    expect(json(res.text).events).toEqual([
      { id: "t-1", type: "TASK_COMMENT_ADDED", at: "2026-09-02T00:00:00Z", by: "Alex Demo", detail: "Demo comment" },
      { id: "t-2", type: "TASK_STATUS_UPDATED", at: "2026-09-03T00:00:00Z", detail: { status: "resolved" } },
    ]);
  });

  it("report tool is read-only (PDF only); the public web link is a separate write tool", async () => {
    const api = new MockApi()
      .on("GET /tasks/v1/incidents/i1/pdf_report", { url: "https://example.test/i1.pdf" })
      .on("POST /tasks/v1/shared_link/i1/web_report", { url: "https://example.test/i1-web" });
    const ro = await connect(api);
    const res = await ro.call("sc_get_issue_report", { issue_id: "i1" });
    expect(res.isError).toBe(false);
    expect(ro.json(res.text)).toMatchObject({ id: "i1", pdf_url: "https://example.test/i1.pdf" });
    expect(api.calls.some((c) => c.path.endsWith("/web_report"))).toBe(false);
    expect((await ro.client.listTools()).tools.map((t) => t.name)).not.toContain("sc_create_issue_share_link");

    const rw = await connect(api, { SC_MODE: "write" });
    const link = await rw.call("sc_create_issue_share_link", { issue_id: "i1" });
    expect(rw.json(link.text)).toMatchObject({ web_report_url: "https://example.test/i1-web" });
    expect(api.calls.find((c) => c.path.endsWith("/web_report"))!.body).toEqual({});
  });

  it("hides write tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_issues");
    expect(names).not.toContain("sc_create_issue");
    expect(names).not.toContain("sc_update_issue");
    expect(names).not.toContain("sc_comment_on_issue");
    expect(names).not.toContain("sc_delete_issues");
  });

  it("creates via the submit endpoint then applies priority, due date and assignees", async () => {
    const api = new MockApi()
      .on("POST /tasks/v1/incidents/submit", { incident_id: "iss-1", unique_id: "IS-1001" })
      .on("PUT /tasks/v1/incidents/iss-1/priority", {})
      .on("PUT /tasks/v1/incidents/iss-1/due_at", {})
      .on("POST /tasks/v1/incidents/iss-1/collaborators/add", {});
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_create_issue", {
      title: "Demo spill",
      category_id: "cat-1",
      description: "Demo description",
      site_id: "site-1",
      occurred_at: "2026-09-01T10:00:00+10:00",
      due_at: "2026-10-31T17:00:00+11:00",
      priority: "high",
      assignees: [{ id: "user_1", type: "user" }],
    });
    expect(res.isError).toBe(false);
    expect(api.calls.find((c) => c.path === "/tasks/v1/incidents/submit")!.body).toEqual({
      title: "Demo spill",
      category_id: "cat-1",
      description: "Demo description",
      site_id: "site-1",
      occurred_at: "2026-09-01T00:00:00.000Z",
    });
    expect(api.calls.find((c) => c.path.endsWith("/priority"))!.body).toEqual({ priority_id: ISSUE_PRIORITY.high });
    expect(api.calls.find((c) => c.path.endsWith("/collaborators/add"))!.body).toEqual({
      collaborators: [{ collaborator_id: "user_1", collaborator_type: "USER", assigned_role: "ASSIGNEE" }],
    });
    expect(json(res.text)).toMatchObject({
      id: "iss-1",
      ref: "IS-1001",
      applied: ["title", "category", "priority", "due_at", "assignees"],
      link: "https://app.safetyculture.com/issues/iss-1",
    });
  });

  it("update sends one request per changed field and reports partial failure", async () => {
    const api = new MockApi()
      .on("PUT /tasks/v1/incidents/a1/status", {})
      .on("PUT /tasks/v1/incidents/a1/priority", () => new Response("nope", { status: 400 }));
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_update_issue", { issue_id: "a1", status: "resolved", priority: "low" });
    expect(res.isError).toBe(false);
    expect(json(res.text)).toMatchObject({ changed: ["status"], failed: [{ field: "priority" }] });
    expect(api.calls.find((c) => c.path.endsWith("/status"))!.body).toEqual({ status_id: ISSUE_STATUS.resolved });
  });

  it("update adds and removes assignees via the collaborators endpoints", async () => {
    const api = new MockApi()
      .on("POST /tasks/v1/incidents/a1/collaborators/add", {})
      .on("POST /tasks/v1/incidents/a1/collaborators/remove", {});
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_update_issue", {
      issue_id: "a1",
      add_assignees: [{ id: "user_1" }],
      remove_assignees: [{ id: "user_9" }],
    });
    expect(json(res.text)).toMatchObject({ changed: ["add_assignees", "remove_assignees"] });
    expect(api.calls.find((c) => c.path.endsWith("/add"))!.body).toEqual({
      collaborators: [{ collaborator_id: "user_1", collaborator_type: "USER", assigned_role: "ASSIGNEE" }],
    });
  });

  it("comments via the timeline endpoint", async () => {
    const api = new MockApi().on("POST /tasks/v1/timeline/comments", {});
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_comment_on_issue", { issue_id: "i1", comment: "Demo comment" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toEqual({ task_id: "i1", comment: "Demo comment" });
    expect(json(res.text)).toMatchObject({ id: "i1" });
  });

  it("delete is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET ^/tasks/v1/incident/[^/]+$", { incident: mkIncident("x") })
      .on("POST /tasks/v1/incidents/delete", {});
    const { call, json } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_delete_issues", { issue_ids: ["x"] });
    expect(dry.text).toContain("DRY RUN");
    expect(dry.text).toContain("Demo issue x");
    expect(api.calls.some((c) => c.path.endsWith("/delete"))).toBe(false);
    expect(json(dry.text).count).toBe(1);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;

    const wrong = await call("sc_delete_issues", { issue_ids: ["x", "y"], confirm_token: token });
    expect(wrong.isError).toBe(true);

    const ok = await call("sc_delete_issues", { issue_ids: ["x"], confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.path.endsWith("/delete"))).toHaveLength(1);
    expect(api.calls.find((c) => c.path.endsWith("/delete"))!.body).toEqual({ ids: ["x"] });

    const replay = await call("sc_delete_issues", { issue_ids: ["x"], confirm_token: token });
    expect(replay.isError).toBe(true);
  });
});
