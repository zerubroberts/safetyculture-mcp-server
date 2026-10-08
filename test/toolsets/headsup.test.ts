import { describe, expect, it } from "vitest";
import { flattenMessageText } from "../../src/toolsets/headsup.js";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const headsUpRow = {
  id: "hu-1",
  title: "Demo Site Notice",
  published_at: "2026-09-01T09:00:00Z",
  author_id: "user_9",
  author_name: "Pat Demo",
  viewed_count: 8,
  acknowledgement_count: 5,
  has_acknowledgement: true,
  assigned_users_count: 10,
  complete: false,
  message_count: 2,
};

function headsUpApi() {
  return new MockApi()
    .on("GET /announcements/v1/announcement:GetHeadsUp", {
      heads_up: {
        id: "hu-1",
        title: "Demo Site Notice",
        description: "Wear demo helmets beyond this point.",
        author_name: "Pat Demo",
        published_at: "2026-09-01T09:00:00Z",
        has_acknowledgement: true,
      },
    })
    .on("POST /announcements/v1/announcement:GetHeadsUpCompletionCounts", { viewed_count: 8, acknowledged_count: 5, message_count: 2 })
    .on("POST /announcements/v1/announcement:ListHeadsUpUsers", {
      users: [
        { id: "user_1", first_name: "Alex", last_name: "Demo", status: true },
        { id: "user_2", first_name: "Sam", last_name: "Demo", status: false },
      ],
      total: 2,
    })
    .on("POST /announcements/v1/announcement:GetHeadsUpMessages", {
      message_response: {
        messages: [
          { id: "m-1", name: "Alex Demo", sent_at: "2026-09-02T00:00:00Z", reply_count: 0, message: [{ text: "Noted, thanks." }] },
        ],
        total: 1,
      },
    });
}

describe("headsup toolset", () => {
  it("flattens message parts to plain text", () => {
    expect(flattenMessageText({ id: "m", message: [{ text: "hi" }, { mention: { text: "@Alex" } }] })).toEqual(["hi", "@Alex"]);
    expect(flattenMessageText({ id: "m" })).toEqual([]);
  });

  it("lists heads ups with search and status filters", async () => {
    const api = new MockApi().on("POST /announcements/v1/announcement:ListHeadsUpManage", {
      heads_ups: [headsUpRow],
      total: 1,
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_heads_ups", { search: "Notice", status: ["incomplete"] });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/announcements/v1/announcement:ListHeadsUpManage" });
    expect(api.calls[0]!.body).toMatchObject({
      page_size: 25,
      sort_field: "SORT_FIELD_PUBLISHED_AT",
      sort_direction: "SORT_DIRECTION_DESC",
      search_value: "Notice",
      filters: { statuses: ["STATUS_FILTER_INCOMPLETE"] },
    });
    expect(json(res.text).heads_ups[0]).toMatchObject({ id: "hu-1", title: "Demo Site Notice", assigned_users: 10 });
  });

  it("gets a heads up with counts, completion split and comments", async () => {
    const api = headsUpApi();
    const { call, json } = await connect(api);
    const res = await call("sc_get_heads_up", { heads_up_id: "hu-1" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");

    const paths = api.calls.map((c) => `${c.method} ${c.path}`).sort();
    expect(paths).toEqual([
      "GET /announcements/v1/announcement:GetHeadsUp",
      "POST /announcements/v1/announcement:GetHeadsUpCompletionCounts",
      "POST /announcements/v1/announcement:GetHeadsUpMessages",
      "POST /announcements/v1/announcement:ListHeadsUpUsers",
    ]);
    expect(api.calls.find((c) => c.method === "GET")!.query).toMatchObject({ id: "hu-1" });
    expect(api.calls.find((c) => c.path.endsWith(":GetHeadsUpCompletionCounts"))!.body).toEqual({ id: "hu-1" });
    expect(api.calls.find((c) => c.path.endsWith(":ListHeadsUpUsers"))!.body).toMatchObject({ heads_up_id: "hu-1" });
    const msgBody = api.calls.find((c) => c.path.endsWith(":GetHeadsUpMessages"))!.body as { message_request: Record<string, unknown> };
    expect(msgBody.message_request).toMatchObject({ reference_id: "hu-1", reference_type: "MESSAGE_REFERENCE_TYPES_HEADS_UP" });

    const data = json(res.text);
    expect(data).toMatchObject({
      id: "hu-1",
      message: "Wear demo helmets beyond this point.",
      counts: { viewed: 8, acknowledged: 5, comments: 2 },
      completed: ["Alex Demo"],
      not_completed: ["Sam Demo"],
      total_assignees: 2,
    });
    expect(data.comments).toEqual([{ author: "Alex Demo", sent_at: "2026-09-02T00:00:00Z", replies: 0, text: "Noted, thanks." }]);
  });

  it("errors clearly for an unknown heads up", async () => {
    const api = new MockApi()
      .on("GET /announcements/v1/announcement:GetHeadsUp", {})
      .on("POST /announcements/v1/announcement:GetHeadsUpCompletionCounts", {})
      .on("POST /announcements/v1/announcement:ListHeadsUpUsers", { users: [] })
      .on("POST /announcements/v1/announcement:GetHeadsUpMessages", { message_response: { messages: [] } });
    const { call } = await connect(api);
    const res = await call("sc_get_heads_up", { heads_up_id: "nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
  });

  it("stays visible in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_heads_ups");
    expect(names).toContain("sc_get_heads_up");
  });
});
