import { z } from "zod";
import { ToolError } from "../core/errors.js";
import { links } from "../core/params.js";
import { defineTool } from "../core/registry.js";

// Read-only GET escape hatch: any documented endpoint the dedicated tools do not cover yet.
// Only paths under these prefixes are allowed, so the tool cannot be steered at account or
// credential endpoints that the dedicated tools deliberately avoid.
const GET_ALLOWLIST = [
  "/feed/",
  "/inspections/",
  "/audits/",
  "/templates/",
  "/tasks/",
  "/incidents/",
  "/assets/",
  "/maintenance/",
  "/directory/",
  "/schedules/",
  "/training/",
  "/heads-up/",
  "/sensors/",
  "/investigations/",
  "/contractors/",
  "/documents/",
  "/response_sets",
  "/groups",
  "/users/",
  "/structures/",
  "/osha/",
];

export const coreTools = [
  defineTool({
    name: "sc_whoami",
    title: "Who am I",
    toolset: "core",
    access: "read",
    core: true,
    description:
      "Shows which Mitti user and organisation the API token belongs to, and the server's safety settings (mode, privacy level, enabled toolsets). Call first if a request fails with a permission error.",
    input: {},
    run: async (_a, ctx) => {
      const me = await ctx.client.get<Record<string, unknown>>("/accounts/user/v1/user:WhoAmI");
      return {
        summary: `Connected as ${[me.firstname, me.lastname].filter(Boolean).join(" ") || "the token's user"}. Mode: ${ctx.config.mode}.`,
        data: {
          user_id: me.user_id,
          organisation_id: me.organisation_id,
          firstname: me.firstname,
          lastname: me.lastname,
          email: me.email,
          server: {
            mode: ctx.config.mode,
            pii: ctx.config.pii,
            toolsets: ctx.config.toolsets,
            api_base_url: ctx.config.baseUrl,
            writes_enabled: ctx.config.mode !== "read-only",
            destructive_enabled: ctx.config.mode === "full",
          },
        },
      };
    },
  }),

  defineTool({
    name: "sc_web_links",
    title: "Web links for records",
    toolset: "core",
    access: "read",
    description: "Builds links that open inspections, inspection reports, actions or issues in the Mitti web app. The viewer must be signed in with access to the record.",
    input: {
      items: z.array(z.object({ kind: z.enum(["inspection", "report", "action", "issue"]), id: z.string() })).min(1).max(100),
    },
    run: async ({ items }) => ({
      summary: `${items.length} links.`,
      data: items.map((i) => ({ ...i, url: links[i.kind](i.id) })),
    }),
  }),

  defineTool({
    name: "sc_api_get",
    title: "Raw API GET (advanced)",
    toolset: "core",
    access: "read",
    description:
      "Advanced: performs a read-only GET on a documented Mitti API path that no dedicated tool covers (see https://developer.mitti.com/llms.txt). Prefer the dedicated tools; they return smaller, cleaner results. Path must start with a known resource prefix such as /feed/, /inspections/, /tasks/, /assets/.",
    input: {
      path: z.string().startsWith("/").describe("API path, e.g. /feed/site_members"),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    run: async ({ path, query }, ctx) => {
      if (path.includes("..") || /^\/\//.test(path)) throw new ToolError("Invalid path.");
      if (!GET_ALLOWLIST.some((p) => path.startsWith(p)))
        throw new ToolError(`Path not allowed. Allowed prefixes: ${GET_ALLOWLIST.join(", ")}`);
      const data = await ctx.client.get(path, query);
      return { summary: `GET ${path} succeeded.`, data, untrusted: true };
    },
  }),
];
