import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { P } from "../core/params.js";
import { defineTool, type ToolContext } from "../core/registry.js";

/**
 * Sites (directory folders) and site membership.
 * Contracts verified 2026-10-08 with `node scripts/api-ref.mjs <slug>`.
 * Hierarchy and members come from the Directory API; the newer Structures
 * API models a separate hierarchy and is not used here.
 */

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why this change is being made. Stored in the local audit log.");

interface RawFolder {
  id: string;
  name: string;
  meta_label?: string;
  members_count?: number;
  created_at?: string;
  modified_at?: string;
}

interface SearchEntry {
  folder: RawFolder;
  ancestors?: RawFolder[];
  members_count?: number;
  has_children?: boolean;
}

interface ChildEntry {
  folder: RawFolder;
  members_count?: number;
  has_children?: boolean;
  children_count?: number;
  depth?: number;
}

/** Compact row: id, name, parent id and level label. */
export function projectSite(e: SearchEntry) {
  const ancestors = e.ancestors ?? [];
  const parent = ancestors[ancestors.length - 1];
  return {
    id: e.folder.id,
    name: e.folder.name,
    parent_id: parent?.id ?? null,
    parent_name: parent?.name,
    level: e.folder.meta_label,
    path: [...ancestors.map((a) => a.name), e.folder.name].join(" / "),
    has_children: e.has_children,
    members_count: e.members_count,
  };
}

interface TreeNode {
  id: string;
  name: string;
  level?: string;
  children_count?: number;
  children?: TreeNode[];
  truncated?: boolean;
}

const CHILD_PAGE = 200;

async function getChildren(ctx: ToolContext, parentId: string): Promise<{ items: ChildEntry[]; truncated: boolean }> {
  const res = await ctx.client.get<{ folders?: ChildEntry[]; next_page_token?: string }>(
    `/directory/v1/parent/${encodeURIComponent(parentId)}/folders`,
    { limit: CHILD_PAGE },
  );
  return { items: res.folders ?? [], truncated: Boolean(res.next_page_token) };
}

export const sitesTools = [
  defineTool({
    name: "sc_list_sites",
    title: "List sites",
    toolset: "sites",
    access: "read",
    core: true,
    description:
      "Lists sites (folders) with text search. Returns compact rows with parent id and level label (location, area, region, state, country). Use sc_get_site for one site's full path and counts.",
    input: {
      text: z.string().optional().describe("Keywords to search site names. Omit to list sites."),
      limit: P.limit(50, 500),
      page_token: P.pageToken,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{
        folders?: SearchEntry[];
        folder_count?: number;
        next_page_token?: string;
      }>("/directory/v1/folders/search", {
        query: a.text,
        limit: a.limit ?? 50,
        page_token: a.page_token,
      });
      const rows = (res.folders ?? []).map(projectSite);
      return {
        summary: `${res.folder_count ?? rows.length} sites match; showing ${rows.length}.${res.next_page_token ? " More available: pass page_token." : ""}`,
        data: { total: res.folder_count, sites: rows, next_page_token: res.next_page_token || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_get_site",
    title: "Get site",
    toolset: "sites",
    access: "read",
    description:
      "Gets one site: name, level label, parent, full path from the root, member count and total children count. Find the ID with sc_list_sites.",
    input: { site_id: z.string().describe("Site (folder) ID.") },
    run: async ({ site_id }, ctx) => {
      const res = await ctx.client.get<{
        folder?: RawFolder;
        ancestors?: RawFolder[];
        all_children_count?: number;
        member_count?: number;
      }>(`/directory/v1/folder/${encodeURIComponent(site_id)}`, {
        with_ancestors: true,
        with_all_children_count: true,
      });
      if (!res.folder) throw new ToolError(`Site ${site_id} was not found.`);
      const ancestors = res.ancestors ?? [];
      const parent = ancestors[ancestors.length - 1];
      return {
        summary: `Site "${res.folder.name}" (${res.folder.meta_label ?? "unknown level"}).`,
        data: {
          id: res.folder.id,
          name: res.folder.name,
          level: res.folder.meta_label,
          parent_id: parent?.id ?? null,
          parent_name: parent?.name,
          path: [...ancestors.map((x) => x.name), res.folder.name].join(" / "),
          members_count: res.member_count,
          children_count: res.all_children_count,
          created_at: res.folder.created_at,
          modified_at: res.folder.modified_at,
        },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_site_tree",
    title: "Get site hierarchy",
    toolset: "sites",
    access: "read",
    description:
      "Returns the site hierarchy as a nested tree. Starts below the given site, or at the top-level sites when omitted. Capped by depth; nodes cut off by the cap are marked truncated.",
    input: {
      site_id: z.string().optional().describe("Root the tree below this site. Omit to start at the top level."),
      depth: z.number().int().min(0).max(5).optional().describe("Levels of children to include (default 3, max 5)."),
    },
    run: async (a, ctx) => {
      const depth = a.depth ?? 3;
      let roots: TreeNode[];
      let rootsTruncated = false;
      if (a.site_id) {
        const res = await ctx.client.get<{ folder?: RawFolder }>(
          `/directory/v1/folder/${encodeURIComponent(a.site_id)}`,
        );
        if (!res.folder) throw new ToolError(`Site ${a.site_id} was not found.`);
        roots = [{ id: res.folder.id, name: res.folder.name, level: res.folder.meta_label }];
      } else {
        const res = await ctx.client.post<{ folders?: SearchEntry[]; next_page_token?: string }>(
          "/directory/v1/folders/search",
          { limit: CHILD_PAGE },
        );
        rootsTruncated = Boolean(res.next_page_token);
        roots = (res.folders ?? [])
          .filter((e) => !(e.ancestors ?? []).length)
          .map((e) => ({ id: e.folder.id, name: e.folder.name, level: e.folder.meta_label }));
      }
      let frontier = roots;
      for (let level = 0; level < depth && frontier.length; level++) {
        const last = level === depth - 1;
        const fetched = await Promise.all(frontier.map((n) => getChildren(ctx, n.id)));
        const next: TreeNode[] = [];
        frontier.forEach((node, i) => {
          const { items, truncated } = fetched[i]!;
          node.children = items.map((c) => ({
            id: c.folder.id,
            name: c.folder.name,
            level: c.folder.meta_label,
            children_count: c.children_count,
          }));
          if (!last) next.push(...node.children.filter((c, j) => items[j]!.has_children));
          else
            node.children.forEach((c, j) => {
              if (items[j]!.has_children) c.truncated = true;
            });
          if (truncated) node.truncated = true;
        });
        frontier = next;
      }
      if (depth === 0) roots.forEach((r) => (r.truncated = true));
      return {
        summary: `Site tree with ${roots.length} root${roots.length === 1 ? "" : "s"}, ${depth} levels deep.`,
        data: { roots, roots_truncated: rootsTruncated || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_list_site_members",
    title: "List site members",
    toolset: "sites",
    access: "read",
    description:
      "Lists the users in one site: id, name, email, active flag and seat type. Includes inherited members from parent sites unless direct_only is set. Details are resolved for up to 100 members.",
    input: {
      site_id: z.string().describe("Site (folder) ID."),
      direct_only: z.boolean().optional().describe("Only directly assigned members, excluding inherited ones."),
      limit: P.limit(50, 100),
    },
    run: async (a, ctx) => {
      const suffix = a.direct_only ? "/users/associated" : "/users";
      const res = await ctx.client.get<{ user_ids?: string[] }>(
        `/directory/v1/folder/${encodeURIComponent(a.site_id)}${suffix}`,
      );
      const ids = res.user_ids ?? [];
      const shown = ids.slice(0, Math.min(100, a.limit ?? 50));
      let members: Array<{ id: string; name?: string; email?: string; active?: boolean; seat_type?: string }> = [];
      if (shown.length) {
        const users = await ctx.client.post<{
          users?: Array<{
            user_id: string;
            first_name?: string;
            last_name?: string;
            email?: string;
            status?: string;
            seat_type?: string;
          }>;
        }>("/users/v1/users/list", { filters: { user_ids: shown } });
        members = (users.users ?? []).map((u) => ({
          id: u.user_id,
          name: [u.first_name, u.last_name].filter(Boolean).join(" ") || undefined,
          email: u.email,
          active: u.status === "USER_ACTIVE_STATUS_ACTIVE",
          seat_type: u.seat_type?.startsWith("SUBSCRIPTION_SEAT_TYPE_")
            ? u.seat_type.slice("SUBSCRIPTION_SEAT_TYPE_".length).toLowerCase()
            : u.seat_type,
        }));
      }
      return {
        summary: `Site has ${ids.length} member${ids.length === 1 ? "" : "s"}; showing ${members.length}.`,
        data: { total: ids.length, members, truncated: ids.length > members.length || undefined },
        untrusted: true,
      };
    },
  }),

  defineTool({
    name: "sc_create_site",
    title: "Create site",
    toolset: "sites",
    access: "write",
    description:
      "Creates one site (folder), optionally under a parent. The level cannot be changed later: use location for places where inspections happen, area/region/state/country for grouping levels.",
    input: {
      name: z.string().min(1).max(250).describe("Site name (1-250 characters)."),
      parent_id: z.string().optional().describe("Parent site ID. Omit to create a top-level site."),
      level: z
        .enum(["location", "area", "region", "state", "country"])
        .optional()
        .describe("Site level (default location)."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ folder?: RawFolder }>("/directory/v1/folder", {
        name: a.name,
        parent_id: a.parent_id,
        meta_label: a.level ?? "location",
      });
      if (!res.folder) throw new ToolError("The API accepted the request but returned no site. Check the site list before retrying, to avoid a duplicate.");
      return {
        summary: `Created site "${res.folder.name}".`,
        data: { id: res.folder.id, name: res.folder.name, level: res.folder.meta_label },
      };
    },
  }),

  defineTool({
    name: "sc_add_site_members",
    title: "Add site members",
    toolset: "sites",
    access: "write",
    description:
      "Adds one or more existing users to one site. Users must already belong to the organisation; find them with sc_search_users.",
    input: {
      site_id: z.string().describe("Site (folder) ID."),
      user_ids: z.array(z.string()).min(1).max(200).describe("User IDs (user_...) to add to the site."),
      reason,
    },
    run: async (a, ctx) => {
      const res = await ctx.client.post<{ assignments?: Record<string, unknown> }>(
        "/directory/v1/users/folders/membership",
        { assignments: { [a.site_id]: { user_ids: a.user_ids } } },
      );
      return {
        summary: `Added ${a.user_ids.length} user${a.user_ids.length === 1 ? "" : "s"} to the site.`,
        data: { site_id: a.site_id, user_ids: a.user_ids, result: res.assignments?.[a.site_id] },
      };
    },
  }),
];
