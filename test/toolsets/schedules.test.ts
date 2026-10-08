import { describe, expect, it } from "vitest";
import { classifyOccurrence, normaliseScheduleStatus, summariseRecurrence } from "../../src/toolsets/schedules.js";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const feedSchedule = {
  id: "sched-1",
  title: "Weekly Depot Check",
  recurrence: "DTSTART:20260105T090000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
  status: "STATUS_ACTIVE",
  template_id: "template_1",
  assignees: ["user_1"],
  site_ids: ["site-1"],
  timezone: "Australia/Melbourne",
};

const legacyItem = {
  id: "legacy-1",
  description: "Monthly Depot Check",
  recurrence: "RRULE:FREQ=MONTHLY;INTERVAL=1",
  status: "PAUSED",
  document: { id: "template_2", name: "Demo Template" },
  assignees: [{ id: "user_2", type: "USER", name: "Alex Demo" }],
  location_id: "site-1",
  next_occurrence: { start: "2026-11-01T09:00:00Z", due: "2026-11-01T17:00:00Z" },
};

const occurrence = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  schedule_id: "sched-1",
  occurrence_id: `occ-${id}`,
  template_id: "template_1",
  start_time: "2026-07-01T09:00:00Z",
  due_time: "2026-07-01T17:00:00Z",
  ...extra,
});

describe("schedules toolset", () => {
  it("summarises recurrences in plain English when derivable", () => {
    expect(summariseRecurrence("DTSTART:20260105T090000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE")).toBe("Weekly on Monday, Wednesday");
    expect(summariseRecurrence("RRULE:FREQ=DAILY;INTERVAL=3")).toBe("Every 3 days");
    expect(summariseRecurrence("RRULE:FREQ=MONTHLY;COUNT=6")).toBe("Monthly, 6 times");
    expect(summariseRecurrence("not a rule")).toBeUndefined();
    expect(summariseRecurrence(undefined)).toBeUndefined();
  });

  it("normalises schedule statuses", () => {
    expect(normaliseScheduleStatus("STATUS_ACTIVE")).toBe("active");
    expect(normaliseScheduleStatus("PAUSED")).toBe("paused");
    expect(normaliseScheduleStatus("FINISHED")).toBe("ended");
    expect(normaliseScheduleStatus("STATUS_ENDED")).toBe("ended");
  });

  it("classifies occurrences from status text and timestamps", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    expect(classifyOccurrence(occurrence("a", { occurrence_status: "COMPLETED", completed_at: "2026-07-01T12:00:00Z" }), now)).toBe("completed");
    expect(classifyOccurrence(occurrence("b", { occurrence_status: "COMPLETED", completed_at: "2026-07-02T12:00:00Z" }), now)).toBe("late");
    expect(classifyOccurrence(occurrence("c", { occurrence_status: "MISSED" }), now)).toBe("missed");
    expect(classifyOccurrence(occurrence("d", { due_time: "2020-01-01T00:00:00Z" }), now)).toBe("missed");
    expect(classifyOccurrence(occurrence("e", { due_time: "2099-01-01T00:00:00Z" }), now)).toBe("upcoming");
    expect(classifyOccurrence(occurrence("f", {}), now)).toBe("missed"); // past due_time, nothing done
  });

  it("classifies OVERDUE occurrences (past miss_time, before due_time) as overdue", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const window = { start_time: "2026-10-08T08:00:00Z", miss_time: "2026-10-08T10:00:00Z", due_time: "2026-10-08T18:00:00Z" };
    expect(classifyOccurrence(occurrence("o1", { ...window, occurrence_status: "OVERDUE" }), now)).toBe("overdue");
    expect(classifyOccurrence(occurrence("o2", { ...window, occurrence_status: "TODO" }), now)).toBe("overdue");
    expect(classifyOccurrence(occurrence("o3", { ...window, miss_time: "2026-10-08T14:00:00Z" }), now)).toBe("upcoming");
    expect(classifyOccurrence(occurrence("o4", { ...window, due_time: "2026-10-08T11:00:00Z" }), now)).toBe("missed");
  });

  it("filters occurrences by overdue", async () => {
    const api = new MockApi().on("GET /scheduling/v1/feed/schedule_occurrences", {
      data: [
        occurrence("o", { occurrence_status: "OVERDUE", miss_time: "2026-10-08T10:00:00Z", due_time: "2099-01-01T17:00:00Z" }),
        occurrence("u", { occurrence_status: "TODO", due_time: "2099-01-01T17:00:00Z" }),
      ],
      metadata: {},
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_schedule_occurrences", { status: ["overdue"] });
    expect(res.isError).toBe(false);
    const data = json(res.text);
    expect(data.occurrences.map((o: { occurrence: string }) => o.occurrence)).toEqual(["occ-o"]);
    expect(data.by_status).toEqual({ overdue: 1 });
  });

  it("pages current schedules then legacy items with a composite cursor", async () => {
    const api = new MockApi()
      .on("GET /scheduling/v1/feed/schedules", (req: { query: Record<string, string> }) =>
        req.query.next_page_token === "cur-2"
          ? { data: [{ ...feedSchedule, id: "sched-2" }], metadata: {} }
          : { data: [feedSchedule], metadata: { next_page_token: "cur-2" } },
      )
      .on("GET /schedules/v1/schedule_items", (req: { query: Record<string, string> }) =>
        req.query.page_token === "leg-2"
          ? { items: [{ ...legacyItem, id: "legacy-2" }], total: 2 }
          : { items: [legacyItem], next_page_token: "leg-2", total: 2 },
      );
    const { call, json } = await connect(api);
    const ids = (d: { schedules: Array<{ id: string }> }) => d.schedules.map((s) => s.id);

    const p1 = json((await call("sc_list_schedules", { limit: 2 })).text);
    expect(ids(p1)).toEqual(["sched-1"]);
    expect(api.calls.some((c) => c.path === "/schedules/v1/schedule_items")).toBe(false);
    expect(p1.next_page_token).toBeTruthy();
    expect(p1.next_page_token).not.toBe("cur-2");

    const p2 = json((await call("sc_list_schedules", { limit: 2, page_token: p1.next_page_token })).text);
    expect(ids(p2)).toEqual(["sched-2", "legacy-1"]);
    const legacyFirst = api.calls.filter((c) => c.path === "/schedules/v1/schedule_items");
    expect(legacyFirst).toHaveLength(1);
    expect(legacyFirst[0]!.query.page_token).toBeUndefined(); // never the current feed's token
    expect(legacyFirst[0]!.query.page_size).toBe("1");

    const feedCallsBefore = api.calls.filter((c) => c.path === "/scheduling/v1/feed/schedules").length;
    const p3 = json((await call("sc_list_schedules", { limit: 2, page_token: p2.next_page_token })).text);
    expect(ids(p3)).toEqual(["legacy-2"]);
    expect(api.calls.filter((c) => c.path === "/scheduling/v1/feed/schedules")).toHaveLength(feedCallsBefore);
    expect(api.calls.filter((c) => c.path === "/schedules/v1/schedule_items").pop()!.query.page_token).toBe("leg-2");
    expect(p3.next_page_token).toBeUndefined();

    const bad = await call("sc_list_schedules", { page_token: "cur-2" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Invalid page_token/);
  });

  it("gets a legacy schedule item from the legacy API when source is legacy", async () => {
    const api = new MockApi().on("GET /schedules/v1/schedule_items", (req: { query: Record<string, string> }) =>
      req.query.page_token === "p2" ? { items: [legacyItem] } : { items: [{ ...legacyItem, id: "legacy-0" }], next_page_token: "p2" },
    );
    const { call, json } = await connect(api);
    const res = await call("sc_get_schedule", { schedule_id: "legacy-1", source: "legacy" });
    expect(res.isError).toBe(false);
    expect(api.calls.every((c) => c.path === "/schedules/v1/schedule_items")).toBe(true);
    expect(json(res.text)).toMatchObject({ source: "legacy", id: "legacy-1", status: "paused", next_due: "2026-11-01T17:00:00Z" });

    const missing = await call("sc_get_schedule", { schedule_id: "legacy-9", source: "legacy" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not found/);
  });

  it("refuses pause, resume and end for legacy items without calling the current API", async () => {
    const api = new MockApi();
    const { call } = await connect(api, { SC_MODE: "full" });
    for (const name of ["sc_pause_schedule", "sc_resume_schedule", "sc_end_schedule"]) {
      const res = await call(name, { schedule_id: "legacy-1", source: "legacy" });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/legacy schedule item/);
    }
    expect(api.calls).toHaveLength(0);
  });

  it("lists current schedules plus legacy items with source labels", async () => {
    const api = new MockApi()
      .on("GET /scheduling/v1/feed/schedules", { data: [feedSchedule], metadata: {} })
      .on("GET /schedules/v1/schedule_items", { items: [legacyItem], total: 1 });
    const { call, json } = await connect(api);
    const res = await call("sc_list_schedules", {});
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");

    const feedCall = api.calls.find((c) => c.path === "/scheduling/v1/feed/schedules")!;
    expect(feedCall.method).toBe("GET");
    expect(feedCall.query).toMatchObject({ limit: "50", show_active: "true", show_paused: "true", show_finished: "true" });
    const legacyCall = api.calls.find((c) => c.path === "/schedules/v1/schedule_items")!;
    expect(legacyCall.method).toBe("GET");
    expect(legacyCall.query).toMatchObject({ page_size: "49" }); // one combined page: 50 minus the 1 current row

    const data = json(res.text);
    expect(data.schedules).toHaveLength(2);
    expect(data.schedules[0]).toMatchObject({
      source: "schedules",
      id: "sched-1",
      status: "active",
      recurrence: "Weekly on Monday",
      sites: ["site-1"],
    });
    expect(data.schedules[1]).toMatchObject({
      source: "legacy",
      id: "legacy-1",
      status: "paused",
      recurrence: "Monthly",
      next_due: "2026-11-01T17:00:00Z",
    });
  });

  it("filters the list by status on both sources", async () => {
    const api = new MockApi()
      .on("GET /scheduling/v1/feed/schedules", { data: [], metadata: {} })
      .on("GET /schedules/v1/schedule_items", { items: [], total: 0 });
    const { call } = await connect(api);
    await call("sc_list_schedules", { status: ["paused"] });
    expect(api.calls.find((c) => c.path === "/scheduling/v1/feed/schedules")!.query).toMatchObject({
      show_active: "false",
      show_paused: "true",
      show_finished: "false",
    });
    expect(api.calls.find((c) => c.path === "/schedules/v1/schedule_items")!.body).toBeUndefined();
    expect(api.calls.find((c) => c.path === "/schedules/v1/schedule_items")!.query).toMatchObject({ statuses: "PAUSED" });
  });

  it("gets one schedule with recurrence in plain English", async () => {
    const api = new MockApi().on("GET /scheduling/v1/schedules/sched-1", {
      id: "sched-1",
      title: "Weekly Depot Check",
      status: "STATUS_ACTIVE",
      work_type: { inspection: { template_id: "template_1", template_name: "Demo Template" } },
      recurrence: { dtstart_rrule: "DTSTART:20260105T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO", duration: "PT8H" },
      assignment: { users: { users: [{ id: "user_1", name: "Alex Demo" }] } },
      target_summary: { target_type: "SCHEDULE_TARGET_TYPE_SITES", total_count: 2 },
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_schedule", { schedule_id: "sched-1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/scheduling/v1/schedules/sched-1" });
    expect(json(res.text)).toMatchObject({
      id: "sched-1",
      status: "active",
      recurrence: "Weekly on Monday",
      template: { id: "template_1", name: "Demo Template" },
    });
  });

  it("lists occurrences with period and status filters", async () => {
    const api = new MockApi().on("GET /scheduling/v1/feed/schedule_occurrences", {
      data: [
        occurrence("m", { occurrence_status: "MISSED" }),
        occurrence("c", { occurrence_status: "COMPLETED", audit_id: "audit_1", completed_at: "2026-07-01T12:00:00Z" }),
        occurrence("u", { occurrence_status: "SCHEDULED", start_time: "2099-01-01T09:00:00Z", due_time: "2099-01-01T17:00:00Z" }),
      ],
      metadata: {},
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_schedule_occurrences", { period: "2026-07-01..2026-09-30", status: ["missed", "upcoming"] });
    expect(res.isError).toBe(false);
    const req = api.calls.find((c) => c.path === "/scheduling/v1/feed/schedule_occurrences")!;
    expect(req.method).toBe("GET");
    // end_date is inclusive, so the exclusive period end is sent minus 1 ms.
    expect(req.query).toMatchObject({ start_date: "2026-07-01T00:00:00.000Z", end_date: "2026-09-30T23:59:59.999Z" });
    const data = json(res.text);
    expect(data.occurrences.map((o: { status: string }) => o.status).sort()).toEqual(["missed", "upcoming"]);
    expect(data.occurrences[0]).toMatchObject({ schedule: "sched-1", status: "missed" });
    expect(data.by_status).toMatchObject({ missed: 1, upcoming: 1 });

    const unfiltered = await call("sc_list_schedule_occurrences", { period: "2026-07-01..2026-09-30" });
    const completed = json(unfiltered.text).occurrences.find((o: { status: string }) => o.status === "completed");
    expect(completed).toMatchObject({ schedule: "sched-1", completed_inspection_id: "audit_1" });
  });

  it("hides write and destructive tools in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_schedules");
    expect(names).toContain("sc_get_schedule");
    expect(names).toContain("sc_list_schedule_occurrences");
    expect(names).not.toContain("sc_pause_schedule");
    expect(names).not.toContain("sc_resume_schedule");
    expect(names).not.toContain("sc_end_schedule");
  });

  it("pauses a schedule's sub-schedules with the exact body", async () => {
    const api = new MockApi().on("PATCH /scheduling/v1/schedules/sched-1/pause", {});
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_pause_schedule", { schedule_id: "sched-1", site_ids: ["site-1", "site-2"] });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "PATCH", path: "/scheduling/v1/schedules/sched-1/pause" });
    expect(api.calls[0]!.body).toEqual({ sites: { site_ids: ["site-1", "site-2"] } });
    expect(json(res.text)).toMatchObject({ id: "sched-1" });
  });

  it("refuses to pause with both sites and assets", async () => {
    const { call } = await connect(new MockApi(), { SC_MODE: "write" });
    const res = await call("sc_pause_schedule", { schedule_id: "sched-1", site_ids: ["site-1"], asset_ids: ["asset-1"] });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/either/);
  });

  it("resumes the whole schedule with an empty body", async () => {
    const api = new MockApi().on("PATCH /scheduling/v1/schedules/sched-1/resume", {});
    const { call } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_resume_schedule", { schedule_id: "sched-1" });
    expect(res.isError).toBe(false);
    expect(api.calls[0]!.body).toEqual({});
  });

  it("end is two-step: dry run first, then exact-args confirm", async () => {
    const api = new MockApi()
      .on("GET /scheduling/v1/schedules/sched-1", { id: "sched-1", title: "Weekly Depot Check", status: "STATUS_ACTIVE" })
      .on("PATCH /scheduling/v1/schedules/sched-1/end", {});
    const { call } = await connect(api, { SC_MODE: "full" });
    const dry = await call("sc_end_schedule", { schedule_id: "sched-1" });
    expect(dry.text).toContain("DRY RUN");
    expect(api.calls.some((c) => c.path.endsWith("/end"))).toBe(false);
    const token = dry.text.match(/confirm_token="([^"]+)"/)![1]!;

    const wrong = await call("sc_end_schedule", { schedule_id: "sched-2", confirm_token: token });
    expect(wrong.isError).toBe(true);

    const ok = await call("sc_end_schedule", { schedule_id: "sched-1", confirm_token: token });
    expect(ok.isError).toBe(false);
    expect(api.calls.filter((c) => c.path.endsWith("/end"))).toHaveLength(1);
    expect(api.calls.find((c) => c.path.endsWith("/end"))!.body).toEqual({});

    const replay = await call("sc_end_schedule", { schedule_id: "sched-1", confirm_token: token });
    expect(replay.isError).toBe(true);
  });
});

import { classifyOccurrence as classifyOcc } from "../../src/toolsets/schedules.js";
describe("occurrence classification edge cases", () => {
  it("in-progress occurrences with an inspection id are not completed; won't-do is its own state", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    expect(classifyOcc({ occurrence_status: "IN_PROGRESS", audit_id: "audit_1", due_time: "2026-10-09T00:00:00Z" } as never, now)).toBe("in_progress");
    expect(classifyOcc({ occurrence_status: "WONT_DO", due_time: "2026-10-01T00:00:00Z" } as never, now)).toBe("wont_do");
    expect(classifyOcc({ occurrence_status: "COMPLETE", audit_id: "audit_1" } as never, now)).toBe("completed");
  });
});
