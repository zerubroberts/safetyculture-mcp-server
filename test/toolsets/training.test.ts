import { describe, expect, it } from "vitest";
import { connect, MockApi } from "../helpers/mock-api.js";

// Synthetic fixtures: no real organisation data.
const course = {
  id: "course-1",
  title: "Demo Safety Basics",
  description: "A demo course.",
  status: "Published",
  locale: "en",
  isMandatory: true,
  duration: 3600,
  modifiedDatetime: "2026-09-01T00:00:00Z",
  isPublished: true,
  lessonCount: 2,
};

describe("training toolset", () => {
  it("lists courses with search and pagination", async () => {
    const api = new MockApi().on("GET /training/courses/v1", { totalCount: 1, items: [course] });
    const { call, json } = await connect(api);
    const res = await call("sc_list_courses", { search: "Safety" });
    expect(res.isError).toBe(false);
    expect(res.text).toContain("<untrusted-data>");
    const req = api.calls[0]!;
    expect(req).toMatchObject({ method: "GET", path: "/training/courses/v1" });
    expect(req.query).toMatchObject({ searchTerm: "Safety", pageSize: "25", page: "1" });
    expect(json(res.text).courses[0]).toMatchObject({ id: "course-1", title: "Demo Safety Basics", mandatory: true, lessons: 2 });
  });

  it("gets one course with its lessons", async () => {
    const api = new MockApi()
      .on("GET /training/courses/v1", { totalCount: 1, items: [course] })
      .on("GET /training/courses/v1/course-1/lessons", {
        lessons: [
          { id: "lesson-1", title: "Welcome", status: "published", minimumScore: 80 },
          { id: "lesson-2", title: "Hazards", status: "published", minimumScore: 70 },
        ],
      });
    const { call, json } = await connect(api);
    const res = await call("sc_get_course", { course_id: "course-1" });
    expect(res.isError).toBe(false);
    expect(api.calls.map((c) => c.path)).toEqual(["/training/courses/v1", "/training/courses/v1/course-1/lessons"]);
    const data = json(res.text);
    expect(data.lessons).toHaveLength(2);
    expect(data.lessons[0]).toMatchObject({ id: "lesson-1", minimum_score: 80 });
  });

  it("errors clearly for an unknown course", async () => {
    const api = new MockApi()
      .on("GET /training/courses/v1", { totalCount: 0, items: [] })
      .on("GET /training/courses/v1/nope/lessons", { lessons: [] });
    const { call } = await connect(api);
    const res = await call("sc_get_course", { course_id: "nope" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
  });

  it("lists training paths", async () => {
    const api = new MockApi().on("GET /training/paths/v1", {
      totalCount: 1,
      items: [{ id: "path-1", title: "Demo Onboarding", isPublished: true }],
    });
    const { call, json } = await connect(api);
    const res = await call("sc_list_training_paths", {});
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/training/paths/v1" });
    expect(json(res.text).paths).toEqual([{ id: "path-1", title: "Demo Onboarding", published: true }]);
  });

  it("reads course progress from the analytics feed", async () => {
    const api = new MockApi().on("GET /training/v1/feed/training-course-progress", {
      data: [
        {
          userId: "user_1",
          userFirstName: "Alex",
          userLastName: "Demo",
          userEmail: "alex.demo@example.com",
          courseId: "course-1",
          courseTitle: "Demo Safety Basics",
          totalLessons: 2,
          completedLessons: 2,
          progressPercent: 100,
          completedAt: "2026-09-02T00:00:00Z",
          score: 90,
          timeSpentSeconds: 1800,
        },
      ],
      metadata: {},
    });
    const { call, json } = await connect(api);
    const res = await call("sc_get_course_progress", { course_id: "course-1", completion: "completed" });
    expect(res.isError).toBe(false);
    const req = api.calls[0]!;
    expect(req).toMatchObject({ method: "GET", path: "/training/v1/feed/training-course-progress" });
    expect(req.query).toMatchObject({ courseId: "course-1", completionStatus: "COMPLETION_STATUS_COMPLETED" });
    const data = json(res.text);
    expect(data.rows[0]).toMatchObject({
      user: { id: "user_1", name: "Alex Demo" },
      course: { id: "course-1" },
      progress_percent: 100,
    });
  });

  it("refuses progress without a course or user filter", async () => {
    const { call } = await connect(new MockApi());
    const res = await call("sc_get_course_progress", {});
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/course_id/);
  });

  it("lists leaderboards without an ID and ranks with one", async () => {
    const api = new MockApi()
      .on("GET /training/individualleaderboards/v1", {
        totalCount: 1,
        items: [{ id: "lb-1", name: "Demo Board", startDate: "2026-01-01T00:00:00Z", endDate: "2026-12-31T00:00:00Z" }],
      })
      .on("GET /training/individualleaderboards/v1/rankings", {
        leaderboardId: "lb-1",
        leaderboardName: "Demo Board",
        rankings: [
          { rank: 1, participantId: "user_1", participantName: "Alex Demo", totalScore: 95 },
          { rank: 2, participantId: "user_2", participantName: "Sam Demo", totalScore: 80 },
        ],
      });
    const { call, json } = await connect(api);
    const listed = await call("sc_training_leaderboard", {});
    expect(api.calls[0]).toMatchObject({ method: "GET", path: "/training/individualleaderboards/v1" });
    expect(json(listed.text).leaderboards).toEqual([
      { id: "lb-1", name: "Demo Board", start: "2026-01-01T00:00:00Z", end: "2026-12-31T00:00:00Z" },
    ]);

    const ranked = await call("sc_training_leaderboard", { leaderboard_id: "lb-1", limit: 1 });
    const rankCall = api.calls.find((c) => c.path === "/training/individualleaderboards/v1/rankings")!;
    expect(rankCall.query).toMatchObject({ leaderboardId: "lb-1" });
    expect(json(ranked.text).rankings).toEqual([{ rank: 1, participant: "Alex Demo", participant_id: "user_1", score: 95 }]);
  });

  it("pages progress with a numeric offset even when the feed returns an opaque token", async () => {
    const row = (id: string) => ({ userId: id, courseId: "course-1", courseTitle: "Demo Safety Basics", progressPercent: 50 });
    const api = new MockApi().on("GET /training/v1/feed/training-course-progress", (req: { query: Record<string, string> }) =>
      req.query.offset === "2"
        ? { data: [row("user_3")], metadata: {} }
        : { data: [row("user_1"), row("user_2")], metadata: { next_page_token: "opaque-token-abc", next_page: "/training/v1/feed/training-course-progress?next_page_token=opaque-token-abc" } },
    );
    const { call, json } = await connect(api);
    const first = await call("sc_get_course_progress", { course_id: "course-1", limit: 2 });
    expect(first.isError).toBe(false);
    const token = json(first.text).next_page_token;
    expect(token).toBe("2");

    const second = await call("sc_get_course_progress", { course_id: "course-1", limit: 2, page_token: token });
    expect(second.isError).toBe(false);
    expect(api.calls[1]!.query).toMatchObject({ offset: "2", limit: "2" });
    expect(json(second.text).rows).toHaveLength(1);
    expect(json(second.text).next_page_token).toBeUndefined();
  });

  it("reports the full leaderboard size and pages rankings instead of silently slicing", async () => {
    const rankings = Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, participantId: `user_${i + 1}`, participantName: `Demo Person ${i + 1}`, totalScore: 100 - i }));
    const api = new MockApi().on("GET /training/individualleaderboards/v1/rankings", { leaderboardId: "lb-1", leaderboardName: "Demo Board", rankings });
    const { call, json } = await connect(api);
    const first = await call("sc_training_leaderboard", { leaderboard_id: "lb-1", limit: 2 });
    expect(first.text).toMatch(/5 ranked participants; showing 2/);
    const p1 = json(first.text);
    expect(p1).toMatchObject({ total: 5, truncated: true, next_page_token: "2" });
    expect(p1.rankings.map((r: { rank: number }) => r.rank)).toEqual([1, 2]);

    const last = json((await call("sc_training_leaderboard", { leaderboard_id: "lb-1", limit: 2, page_token: "4" })).text);
    expect(last.rankings.map((r: { rank: number }) => r.rank)).toEqual([5]);
    expect(last.truncated).toBeUndefined();
    expect(last.next_page_token).toBeUndefined();
  });

  it("hides the assign tool in read-only mode", async () => {
    const { client } = await connect(new MockApi(), { SC_MODE: "read-only" });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("sc_list_courses");
    expect(names).toContain("sc_get_course_progress");
    expect(names).not.toContain("sc_assign_course");
  });

  it("assigns a course with mapped assignment types", async () => {
    const api = new MockApi().on("PUT /training/courses/v1/course-1/assignments", { usersUpdated: 1, groupsUpdated: 1, sitesUpdated: 0 });
    const { call, json } = await connect(api, { SC_MODE: "write" });
    const res = await call("sc_assign_course", {
      course_id: "course-1",
      assign: [
        { id: "user_1", type: "user", assigned: true },
        { id: "group-1", type: "group", assigned: false },
      ],
    });
    expect(res.isError).toBe(false);
    expect(api.calls[0]).toMatchObject({ method: "PUT", path: "/training/courses/v1/course-1/assignments" });
    expect(api.calls[0]!.body).toMatchObject({
      assignments: [
        { id: "user_1", type: "ASSIGNMENT_TYPE_USER", isAssigned: true },
        { id: "group-1", type: "ASSIGNMENT_TYPE_GROUP", isAssigned: false },
      ],
    });
    expect(json(res.text)).toMatchObject({ users_updated: 1, groups_updated: 1 });
  });

  it("refuses an empty assignment", async () => {
    const { call } = await connect(new MockApi(), { SC_MODE: "write" });
    const res = await call("sc_assign_course", { course_id: "course-1" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Nothing to change/);
  });
});
