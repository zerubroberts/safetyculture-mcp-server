import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";

/**
 * Training courses, lessons, learning paths, progress analytics and
 * leaderboards.
 *
 * Contract notes (verified with `node scripts/api-ref.mjs` 2026-10-08):
 * - There is no GET-single-course endpoint; sc_get_course filters
 *   `GET /training/courses/v1` by courseIds and adds
 *   `GET /training/courses/v1/{courseId}/lessons`.
 * - sc_get_course_progress reads the `GET /training/v1/feed/training-course-progress`
 *   feed, which is served from the analytics warehouse (refreshes every
 *   30 minutes to 2 hours), not live data.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface RawCourse {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  locale?: string;
  isMandatory?: boolean;
  dueBy?: string;
  duration?: number;
  createdDatetime?: string;
  modifiedDatetime?: string;
  isPublished?: boolean;
  lessonCount?: number;
}

interface RawLesson {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  minimumScore?: number;
}

interface RawProgress {
  userId?: string;
  userEmail?: string;
  userFirstName?: string;
  userLastName?: string;
  courseId?: string;
  courseTitle?: string;
  totalLessons?: number;
  completedLessons?: number;
  progressPercent?: number;
  score?: number;
  openedAt?: string;
  completedAt?: string;
  dueAt?: string;
  timeSpentSeconds?: number;
}

function projectCourse(c: RawCourse) {
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    published: c.isPublished,
    mandatory: c.isMandatory,
    lessons: c.lessonCount,
    duration_seconds: c.duration,
    locale: c.locale,
    modified: c.modifiedDatetime,
  };
}

function projectProgress(p: RawProgress) {
  const name = [p.userFirstName, p.userLastName].filter(Boolean).join(" ") || undefined;
  return {
    user: { id: p.userId, name, email: p.userEmail },
    course: { id: p.courseId, title: p.courseTitle },
    progress_percent: p.progressPercent,
    lessons: { completed: p.completedLessons, total: p.totalLessons },
    completed_at: p.completedAt || undefined,
    opened_at: p.openedAt || undefined,
    score: p.score,
    time_spent_seconds: p.timeSpentSeconds,
  };
}

const courseId = z.string().describe("Course ID (from sc_list_courses).");

/** Training list endpoints use 1-based `page` / `pageSize`, mapped from limit + page_token. */
async function listPaged<T>(
  ctx: ToolContext,
  path: string,
  extra: Record<string, string | number | undefined>,
  opts: { limit?: number; pageToken?: string },
): Promise<{ items: T[]; total: number; nextPageToken: string | undefined }> {
  const pageSize = Math.min(1000, opts.limit ?? 25);
  const page = opts.pageToken ? Number(opts.pageToken) : 1;
  if (!Number.isInteger(page) || page < 1) throw new ToolError(`Invalid page_token "${opts.pageToken}": expected a page number from a previous call.`);
  const res = await ctx.client.get<{ items?: T[]; totalCount?: number }>(path, { ...extra, pageSize, page });
  const total = res.totalCount ?? res.items?.length ?? 0;
  return { items: res.items ?? [], total, nextPageToken: page * pageSize < total ? String(page + 1) : undefined };
}

export const trainingTools = [
  defineTool({
    name: "sc_list_courses",
    title: "List training courses",
    toolset: "training",
    access: "read",
    description:
      "Lists training courses with optional text search. Rows carry title, status, whether published and mandatory, lesson count and duration.",
    input: {
      search: z.string().optional().describe("Text to match against course titles."),
      limit: P.limit(25, 1000),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const { items, total, nextPageToken } = await listPaged<RawCourse>(ctx, "/training/courses/v1", { searchTerm: a.search }, a);
      return {
        summary: `${total} courses match; showing ${items.length}.${nextPageToken ? " More available: pass next_page_token." : ""}`,
        data: { total, courses: items.map(projectCourse), next_page_token: nextPageToken },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_course",
    title: "Get training course",
    toolset: "training",
    access: "read",
    description: "Gets one training course with its lessons: lesson titles, statuses and pass scores.",
    input: { course_id: courseId },
    run: async ({ course_id }, ctx) => {
      const [courseRes, lessonRes] = await Promise.all([
        ctx.client.get<{ items?: RawCourse[] }>("/training/courses/v1", { courseIds: course_id }),
        ctx.client.get<{ lessons?: RawLesson[] }>(`/training/courses/v1/${encodeURIComponent(course_id)}/lessons`),
      ]);
      const course = courseRes.items?.[0];
      if (!course) throw new ToolError(`Course ${course_id} was not found.`);
      const lessons = lessonRes.lessons ?? [];
      return {
        summary: `Course "${course.title}" has ${lessons.length} lessons.`,
        data: {
          ...projectCourse(course),
          description: course.description,
          lessons: lessons.map((l) => ({ id: l.id, title: l.title, status: l.status, minimum_score: l.minimumScore })),
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_training_paths",
    title: "List training paths",
    toolset: "training",
    access: "read",
    description: "Lists learning paths (ordered course groups) with their publication status.",
    input: {
      limit: P.limit(25, 1000),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const { items, total, nextPageToken } = await listPaged<{ id: string; title?: string; isPublished?: boolean }>(
        ctx,
        "/training/paths/v1",
        {},
        a,
      );
      return {
        summary: `${total} learning paths; showing ${items.length}.${nextPageToken ? " More available: pass next_page_token." : ""}`,
        data: {
          total,
          paths: items.map((p) => ({ id: p.id, title: p.title, published: p.isPublished })),
          next_page_token: nextPageToken,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_course_progress",
    title: "Get course progress",
    toolset: "training",
    access: "read",
    description:
      "Shows per-user completion of training courses from training analytics: progress percent, lessons completed, completion time, score and time spent. Filter by course, by user, or by completion state. Analytics data refreshes every 30 minutes to 2 hours, so very recent completions may not appear yet.",
    input: {
      course_id: courseId.optional(),
      user_id: P.userId,
      completion: z.enum(["completed", "not_completed", "all"]).optional().describe("Only rows in this completion state. Default: all."),
      limit: P.limit(50, 1000),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      if (!a.course_id && !a.user_id)
        throw new ToolError("Pass course_id, user_id, or both: refusing to dump progress for every user and course.");
      const completionStatus =
        a.completion === "completed"
          ? "COMPLETION_STATUS_COMPLETED"
          : a.completion === "not_completed"
            ? "COMPLETION_STATUS_NON_COMPLETED"
            : undefined;
      const offset = a.page_token ? Number(a.page_token) : undefined;
      if (a.page_token && (!Number.isInteger(offset) || (offset ?? 0) < 0))
        throw new ToolError(`Invalid page_token "${a.page_token}": expected an offset from a previous call.`);
      const res = await ctx.client.get<{ data?: RawProgress[]; metadata?: { next_page_token?: string } }>(
        "/training/v1/feed/training-course-progress",
        {
          courseId: a.course_id,
          userId: a.user_id,
          completionStatus,
          limit: Math.min(1000, a.limit ?? 50),
          offset,
        },
      );
      const rows = (res.data ?? []).map(projectProgress);
      const done = rows.filter((r) => r.completed_at).length;
      return {
        summary: `${rows.length} progress rows (${done} completed). Analytics data, refreshed every 30 min-2 h.${res.metadata?.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { rows, next_page_token: res.metadata?.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_training_leaderboard",
    title: "Get training leaderboard",
    toolset: "training",
    access: "read",
    description:
      "Without a leaderboard ID, lists the organisation's individual leaderboards. With one, returns its rankings: rank, participant and score.",
    input: {
      leaderboard_id: z.string().optional().describe("Leaderboard ID (omit to list leaderboards)."),
      limit: P.limit(50, 1000),
    },
    run: async (a, ctx) => {
      if (!a.leaderboard_id) {
        const res = await ctx.client.get<{
          totalCount?: number;
          items?: Array<{ id: string; name?: string; startDate?: string; endDate?: string; learnerAccess?: boolean }>;
        }>("/training/individualleaderboards/v1", { pageSize: Math.min(1000, a.limit ?? 50), page: 1 });
        const items = res.items ?? [];
        return {
          summary: `${res.totalCount ?? items.length} leaderboards.`,
          data: {
            leaderboards: items.map((l) => ({ id: l.id, name: l.name, start: l.startDate, end: l.endDate })),
          },
          untrusted: true,
        };
      }
      const res = await ctx.client.get<{
        leaderboardId?: string;
        leaderboardName?: string;
        rankings?: Array<{ rank?: number; participantId?: string; participantName?: string; totalScore?: number; isNotAttempted?: boolean }>;
      }>("/training/individualleaderboards/v1/rankings", { leaderboardId: a.leaderboard_id });
      const rankings = (res.rankings ?? []).slice(0, a.limit ?? 50);
      return {
        summary: `Leaderboard "${res.leaderboardName ?? a.leaderboard_id}": ${rankings.length} ranked participants.`,
        data: {
          leaderboard: { id: res.leaderboardId ?? a.leaderboard_id, name: res.leaderboardName },
          rankings: rankings.map((r) => ({ rank: r.rank, participant: r.participantName, participant_id: r.participantId, score: r.totalScore })),
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_assign_course",
    title: "Assign training course",
    toolset: "training",
    access: "write",
    idempotent: true,
    description:
      "Updates who a training course is assigned to: assign or unassign users, groups and sites, grant universal access, or clear all assignments of a type. PUT-style: repeating the same call is safe.",
    input: {
      course_id: courseId,
      assign: z
        .array(
          z.object({
            id: z.string().describe("User, group or site ID."),
            type: z.enum(["user", "group", "site"]),
            assigned: z.boolean().describe("True to assign, false to unassign."),
          }),
        )
        .max(1000)
        .optional()
        .describe("Individual assignment changes. Find users with sc_search_users, groups with sc_list_groups, sites with sc_list_sites."),
      universal_access: z.boolean().optional().describe("Assign the course to every training user in the organisation."),
      clear_users: z.boolean().optional().describe("Remove all user assignments."),
      clear_groups: z.boolean().optional().describe("Remove all group assignments."),
      clear_sites: z.boolean().optional().describe("Remove all site assignments."),
      reason,
    },
    run: async (a, ctx) => {
      if (!a.assign?.length && a.universal_access === undefined && !a.clear_users && !a.clear_groups && !a.clear_sites)
        throw new ToolError("Nothing to change: pass assign entries, universal_access, or a clear_* flag.");
      const typeId = { user: "ASSIGNMENT_TYPE_USER", group: "ASSIGNMENT_TYPE_GROUP", site: "ASSIGNMENT_TYPE_SITE" } as const;
      const res = await ctx.client.put<{ usersUpdated?: number; groupsUpdated?: number; sitesUpdated?: number }>(
        `/training/courses/v1/${encodeURIComponent(a.course_id)}/assignments`,
        {
          assignments: a.assign?.map((x) => ({ id: x.id, type: typeId[x.type], isAssigned: x.assigned })),
          universalAccess: a.universal_access,
          clearAllUsers: a.clear_users,
          clearAllGroups: a.clear_groups,
          clearAllSites: a.clear_sites,
        },
      );
      return {
        summary: `Updated assignments for course ${a.course_id}: ${res.usersUpdated ?? 0} user(s), ${res.groupsUpdated ?? 0} group(s), ${res.sitesUpdated ?? 0} site(s).`,
        data: { course_id: a.course_id, users_updated: res.usersUpdated ?? 0, groups_updated: res.groupsUpdated ?? 0, sites_updated: res.sitesUpdated ?? 0 },
      };
    },
  }),
];
