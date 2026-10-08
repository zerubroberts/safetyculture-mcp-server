import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool } from "../core/registry.js";

/**
 * Users, groups and permission sets.
 * Contracts verified 2026-10-08 with `node scripts/api-ref.mjs <slug>`.
 * Uncertainty: POST /users/v1/users/list documents exact-match filters only
 * ("Partial, fuzzy, and wildcard searches are not supported"), so the `text`
 * filter is applied client-side per page. The same endpoint returns no
 * last-seen timestamp, so `last_seen` is only populated when the API
 * provides one. User creation, deactivation and permission-set assignment
 * are deliberately not implemented.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface RawUserV1 {
  user_id: string;
  first_name?: string;
  firstname?: string;
  last_name?: string;
  lastname?: string;
  email?: string;
  username?: string;
  status?: string;
  seat_type?: string;
  timezone?: string;
  locale?: string;
  created_at?: string;
  last_seen?: string;
}

const seatName = (s: string | undefined) =>
  s && s.startsWith("SUBSCRIPTION_SEAT_TYPE_") ? s.slice("SUBSCRIPTION_SEAT_TYPE_".length).toLowerCase() : s;

/** Normalises both the v1 (`first_name`) and legacy (`firstname`) user shapes. */
export function projectUser(u: RawUserV1) {
  const name = [u.first_name ?? u.firstname, u.last_name ?? u.lastname].filter(Boolean).join(" ") || undefined;
  return {
    id: u.user_id,
    name,
    email: u.email,
    active: u.status === "USER_ACTIVE_STATUS_ACTIVE" || u.status === "active",
    seat_type: seatName(u.seat_type) ?? u.seat_type,
    ...(u.last_seen ? { last_seen: u.last_seen } : {}),
  };
}

function matchesText(u: RawUserV1, text: string): boolean {
  const hay = [u.first_name, u.firstname, u.last_name, u.lastname, u.email, u.username]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export const peopleTools = [
  defineTool({
    name: "sc_search_users",
    title: "Search users",
    toolset: "people",
    access: "read",
    core: true,
    description:
      "Searches organisation members by name/email text, active flag and/or group. Returns compact rows with seat type. The API has no substring search, so text is matched within the returned page.",
    input: {
      text: z.string().optional().describe("Words that must all appear in the name, email or username."),
      active: z.boolean().optional().describe("Only active (true) or deactivated (false) users."),
      group_id: z.string().optional().describe("Only members of this group. Use sc_list_groups to find it."),
      limit: P.limit(50, 200),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      let rows: ReturnType<typeof projectUser>[];
      let next: string | undefined;
      if (a.group_id) {
        const res = await ctx.client.get<{
          users?: RawUserV1[];
          total?: number;
        }>(`/groups/${encodeURIComponent(a.group_id)}/users`, {
          limit: 2000,
          status: a.active === undefined ? undefined : a.active ? "active" : "inactive",
        });
        const all = (res.users ?? []).map(projectUser);
        const filtered = a.text
          ? all.filter((_, i) => matchesText(res.users![i]!, a.text!))
          : all;
        const offset = a.page_token ? Number(a.page_token) : 0;
        if (!Number.isInteger(offset) || offset < 0) throw new ToolError("Invalid page_token.");
        const limit = a.limit ?? 50;
        rows = filtered.slice(offset, offset + limit);
        if (offset + limit < filtered.length) next = String(offset + limit);
      } else {
        const res = await ctx.client.post<{ users?: RawUserV1[]; next_page_token?: string }>(
          "/users/v1/users/list",
          {
            page_size: Math.min(200, a.limit ?? 50),
            page_token: a.page_token,
            ...(a.active === undefined
              ? { list_all: true }
              : { filters: { statuses: [a.active ? "USER_ACTIVE_STATUS_ACTIVE" : "USER_ACTIVE_STATUS_DEACTIVATED"] } }),
          },
        );
        rows = (res.users ?? [])
          .filter((u) => !a.text || matchesText(u, a.text))
          .map(projectUser);
        next = res.next_page_token || undefined;
      }
      return {
        summary: `Found ${rows.length} users${next ? "; more available: pass page_token" : ""}.`,
        data: { users: rows, next_page_token: next },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_user",
    title: "Get user",
    toolset: "people",
    access: "read",
    description: "Gets one user: name, email, active flag, seat type, username and locale. Find the ID with sc_search_users.",
    input: { user_id: z.string().describe("User ID (user_...).") },
    run: async ({ user_id }, ctx) => {
      const res = await ctx.client.post<{ users?: RawUserV1[] }>("/users/v1/users/list", {
        filters: { user_ids: [user_id] },
      });
      const u = res.users?.[0];
      if (!u) throw new ToolError(`User ${user_id} was not found.`);
      return {
        summary: `User "${[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || user_id}".`,
        data: {
          ...projectUser(u),
          username: u.username,
          timezone: u.timezone,
          locale: u.locale,
          created_at: u.created_at,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_groups",
    title: "List groups",
    toolset: "people",
    access: "read",
    description:
      "Lists all groups in the organisation (ID and name). Call before filtering users by group or managing group membership.",
    input: {},
    run: async (_a, ctx) => {
      const res = await ctx.client.get<{ groups?: Array<{ id: string; name: string }> }>("/groups");
      const rows = res.groups ?? [];
      return { summary: `Found ${rows.length} groups.`, data: { groups: rows } };
    },
  }),

  defineTool({
    name: "sc_list_group_members",
    title: "List group members",
    toolset: "people",
    access: "read",
    description:
      "Lists the members of one group: id, name, email, active flag and seat type. Find the group ID with sc_list_groups.",
    input: {
      group_id: z.string().describe("Group ID."),
      active: z.boolean().optional().describe("Only active (true) or deactivated (false) members."),
      limit: P.limit(50, 500),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const offset = a.page_token ? Number(a.page_token) : 0;
      if (!Number.isInteger(offset) || offset < 0) throw new ToolError("Invalid page_token.");
      const limit = a.limit ?? 50;
      const res = await ctx.client.get<{ users?: RawUserV1[]; total?: number }>(
        `/groups/${encodeURIComponent(a.group_id)}/users`,
        {
          limit,
          offset,
          status: a.active === undefined ? undefined : a.active ? "active" : "inactive",
        },
      );
      const rows = (res.users ?? []).map(projectUser);
      const total = res.total ?? offset + rows.length;
      const next = offset + rows.length < total ? String(offset + rows.length) : undefined;
      return {
        summary: `Group has ${total} members; showing ${rows.length}.${next ? " More available: pass page_token." : ""}`,
        data: { total, members: rows, next_page_token: next },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_permission_sets",
    title: "List permission sets",
    toolset: "people",
    access: "read",
    description:
      "Lists permission sets (ID, name, type, minimum seat, enabled permissions). Read-only: assigning permission sets is out of scope.",
    input: {
      text: z.string().optional().describe("Filter permission sets by this search text."),
      limit: P.limit(50, 100),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const offset = a.page_token ? Number(a.page_token) : 0;
      if (!Number.isInteger(offset) || offset < 0) throw new ToolError("Invalid page_token.");
      const limit = Math.min(100, a.limit ?? 50);
      const res = await ctx.client.post<{
        permission_sets?: Array<{
          permission_set?: {
            identifier?: {
              id?: string;
              type?: string;
              name?: string;
              description?: string;
              allowed_seat_types?: string[];
            };
            modified_at?: string;
            permissions?: Record<string, boolean>;
          };
        }>;
      }>("/permissions/v1/permission_sets", { search: a.text, limit, offset });
      const rows = (res.permission_sets ?? []).map((p) => {
        const id = p.permission_set?.identifier;
        const perms = p.permission_set?.permissions ?? {};
        return {
          id: id?.id,
          name: id?.name,
          type: id?.type?.startsWith("PERMISSION_SET_TYPE_")
            ? id.type.slice("PERMISSION_SET_TYPE_".length).toLowerCase()
            : id?.type,
          description: id?.description,
          min_seat: seatName(id?.allowed_seat_types?.[0]),
          enabled_permissions: Object.entries(perms)
            .filter(([, v]) => v === true)
            .map(([k]) => k)
            .sort(),
          modified_at: p.permission_set?.modified_at,
        };
      });
      const next = rows.length === limit ? String(offset + limit) : undefined;
      return {
        summary: `Found ${rows.length} permission sets${next ? "; more available: pass page_token" : ""}.`,
        data: { permission_sets: rows, next_page_token: next },
      };
    },
  }),

  defineTool({
    name: "sc_add_user_to_group",
    title: "Add user to group",
    toolset: "people",
    access: "write",
    description:
      "Adds an existing organisation member to a group. Find IDs with sc_search_users and sc_list_groups.",
    input: {
      group_id: z.string().describe("Group ID."),
      user_id: z.string().describe("User ID (user_...) of an existing organisation member."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ users?: string[] }>(`/groups/${encodeURIComponent(a.group_id)}/users/v2`, {
        user_id: a.user_id,
      });
      return {
        summary: `Added user to the group (now ${res.users?.length ?? "?"} members).`,
        data: { group_id: a.group_id, user_id: a.user_id, member_count: res.users?.length },
      };
    },
  }),

  defineTool({
    name: "sc_remove_user_from_group",
    title: "Remove user from group",
    toolset: "people",
    access: "destructive",
    description:
      "Removes a user from a group, revoking the access that group grants. Past contributions (inspections, actions) are kept. Removing a user from their only organisation moves them to a personal organisation instead.",
    input: {
      group_id: z.string().describe("Group ID."),
      user_id: z.string().describe("User ID (user_...) to remove."),
      reason,
    },
    plan: async (a, ctx) => {
      const [members, lookup] = await Promise.all([
        ctx.client.get<{ users?: RawUserV1[] }>(`/groups/${encodeURIComponent(a.group_id)}/users`, { limit: 2000 }),
        ctx.client
          .post<{ users?: RawUserV1[] }>("/users/v1/users/list", { filters: { user_ids: [a.user_id] } })
          .catch(() => ({ users: [] as RawUserV1[] })),
      ]);
      const member = (members.users ?? []).find((u) => u.user_id === a.user_id);
      const known = lookup.users?.[0];
      const name =
        [known?.first_name ?? member?.first_name, known?.last_name ?? member?.last_name]
          .filter(Boolean)
          .join(" ") || undefined;
      return {
        summary: member
          ? `User "${name ?? a.user_id}" (${member.email ?? known?.email ?? "no email"}) would be removed from the group.`
          : `User ${a.user_id} is not a member of the group; nothing would change.`,
        data: {
          group_id: a.group_id,
          user: { id: a.user_id, name, email: member?.email ?? known?.email, is_member: Boolean(member) },
        },
        untrusted: true,
      };
    },
    run: async (a, ctx) => {
      const res = await ctx.client.delete<{ ok?: boolean }>(
        `/groups/${encodeURIComponent(a.group_id)}/users/${encodeURIComponent(a.user_id)}`,
      );
      if (!res.ok) throw new ToolError("The API reported the user was not removed. They may already be out of the group.");
      return { summary: "Removed user from the group.", data: { group_id: a.group_id, user_id: a.user_id } };
    },
  }),
];
