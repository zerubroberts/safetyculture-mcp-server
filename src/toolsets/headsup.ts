import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool } from "../core/registry.js";

/**
 * Heads Up announcements: list, read the message, completion counts, who has
 * and has not completed, and comments.
 *
 * Contract notes (verified with `node scripts/api-ref.mjs` 2026-10-08):
 * - Listing is `POST /announcements/v1/announcement:ListHeadsUpManage`;
 *   single read is `GET /announcements/v1/announcement:GetHeadsUp?id=...`.
 * - Completion counts, assignees and comments are three separate calls
 *   (:GetHeadsUpCompletionCounts, :ListHeadsUpUsers, :GetHeadsUpMessages),
 *   fanned out in parallel by sc_get_heads_up.
 */

const STATUS_FILTERS = {
  incomplete: "STATUS_FILTER_INCOMPLETE",
  completed: "STATUS_FILTER_COMPLETED",
  draft: "STATUS_FILTER_DRAFT",
  scheduled: "STATUS_FILTER_SCHEDULED",
} as const;

interface RawHeadsUpRow {
  id: string;
  title?: string;
  published_at?: string;
  author_id?: string;
  author_name?: string;
  viewed_count?: number;
  acknowledgement_count?: number;
  has_acknowledgement?: boolean;
  assigned_users_count?: number;
  complete?: boolean;
  message_count?: number;
}

interface RawUser {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  completion_details?: {
    viewed?: boolean;
    viewed_at?: string;
    acknowledged?: boolean;
    acknowledged_at?: string;
  };
  status?: boolean;
}

interface RawMessage {
  id: string;
  user_id?: string;
  name?: string;
  sent_at?: string;
  reply_count?: number;
  message?: Array<{ text?: unknown; mention?: unknown }>;
}

function projectRow(h: RawHeadsUpRow) {
  return {
    id: h.id,
    title: h.title,
    author: h.author_name,
    published_at: h.published_at,
    assigned_users: h.assigned_users_count,
    viewed: h.viewed_count,
    acknowledged: h.acknowledgement_count,
    needs_acknowledgement: h.has_acknowledgement,
    complete: h.complete,
    comments: h.message_count,
  };
}

/** The messages endpoint nests comment text; flatten to plain strings. */
export function flattenMessageText(m: RawMessage): string[] {
  const out: string[] = [];
  for (const part of m.message ?? []) {
    if (typeof part.text === "string") out.push(part.text);
    else if (part.text && typeof part.text === "object") {
      const t = (part.text as Record<string, unknown>).text ?? (part.text as Record<string, unknown>).body;
      if (typeof t === "string") out.push(t);
    }
    if (part.mention && typeof part.mention === "object") {
      const t = (part.mention as Record<string, unknown>).text;
      if (typeof t === "string") out.push(t);
    }
  }
  return out;
}

export const headsupTools = [
  defineTool({
    name: "sc_list_heads_ups",
    title: "List Heads Ups",
    toolset: "headsup",
    access: "read",
    description:
      "Lists Heads Up announcements with optional text search and status filter. Rows carry author, publish time, assigned user count, view/acknowledgement counts and comment count.",
    input: {
      search: z.string().optional().describe("Text to match against titles."),
      status: z.array(z.enum(["incomplete", "completed", "draft", "scheduled"])).optional().describe("Filter by status. Default: all."),
      limit: P.limit(25, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ heads_ups?: RawHeadsUpRow[]; next_page_token?: string; total?: number }>(
        "/announcements/v1/announcement:ListHeadsUpManage",
        {
          page_size: Math.min(100, a.limit ?? 25),
          page_token: a.page_token,
          sort_field: "SORT_FIELD_PUBLISHED_AT",
          sort_direction: "SORT_DIRECTION_DESC",
          search_value: a.search,
          filters: a.status?.length ? { statuses: a.status.map((s) => STATUS_FILTERS[s]) } : undefined,
        },
      );
      const rows = (res.heads_ups ?? []).map(projectRow);
      return {
        summary: `${res.total ?? rows.length} Heads Ups match; showing ${rows.length}.${res.next_page_token ? " More available: pass next_page_token." : ""}`,
        data: { total: res.total, heads_ups: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_heads_up",
    title: "Get Heads Up",
    toolset: "headsup",
    access: "read",
    description:
      "Gets one Heads Up in full: message, completion counts, who has and has not completed it, and comments. Message text and comments are user-written.",
    input: {
      heads_up_id: z.string().describe("Heads Up ID (from sc_list_heads_ups)."),
      comments_limit: P.limit(20, 100),
      users_limit: z.number().int().min(1).max(1000).optional().describe("Max assignees to split into completed / not completed (default 200, max 1000)."),
    },
    run: async (a, ctx) => {
      const id = a.heads_up_id;
      const [got, counts, users, messages] = await Promise.all([
        ctx.client.get<{
          heads_up?: {
            id?: string;
            title?: string;
            description?: string;
            author_id?: string;
            author_name?: string;
            published_at?: string;
            has_acknowledgement?: boolean;
            is_comments_disabled?: boolean;
          };
        }>("/announcements/v1/announcement:GetHeadsUp", { id }),
        ctx.client.post<{ viewed_count?: number; acknowledged_count?: number; message_count?: number }>(
          "/announcements/v1/announcement:GetHeadsUpCompletionCounts",
          { id },
        ),
        ctx.client.post<{ users?: RawUser[]; total?: number }>("/announcements/v1/announcement:ListHeadsUpUsers", {
          heads_up_id: id,
          page_size: Math.min(1000, a.users_limit ?? 200),
        }),
        ctx.client
          .post<{ message_response?: { messages?: RawMessage[]; total?: number } }>(
            "/announcements/v1/announcement:GetHeadsUpMessages",
            {
              message_request: {
                reference_id: id,
                reference_type: "MESSAGE_REFERENCE_TYPES_HEADS_UP",
                page_size: Math.min(100, a.comments_limit ?? 20),
                sort_direction: "SORT_DIRECTION_ASC",
              },
            },
          )
          .catch(() => ({ message_response: undefined })),
      ]);
      const headsUp = got.heads_up;
      if (!headsUp?.id) throw new ToolError(`Heads Up ${id} was not found.`);
      const all = users.users ?? [];
      const done = all.filter((u) => u.status);
      const pending = all.filter((u) => !u.status);
      const name = (u: RawUser) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || u.id;
      const comments = (messages.message_response?.messages ?? []).map((m) => ({
        author: m.name,
        sent_at: m.sent_at,
        replies: m.reply_count,
        text: flattenMessageText(m).join("\n"),
      }));
      return {
        summary: `Heads Up "${headsUp.title}": ${done.length} of ${all.length} assignees completed, ${comments.length} comments shown.`,
        data: {
          id: headsUp.id,
          title: headsUp.title,
          message: headsUp.description,
          author: headsUp.author_name,
          published_at: headsUp.published_at,
          needs_acknowledgement: headsUp.has_acknowledgement,
          counts: { viewed: counts.viewed_count, acknowledged: counts.acknowledged_count, comments: counts.message_count },
          completed: done.map(name),
          not_completed: pending.map(name),
          completed_count: done.length,
          not_completed_count: pending.length,
          total_assignees: users.total ?? all.length,
          comments,
        },
        untrusted: true,
      };
    },
  }),
];
