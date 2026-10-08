import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_TOKEN, liveClient, shape } from "./helpers.js";

// For every "get one record" tool: take the first id from its list tool and call it.
// Logs only tool names and result sizes.
const d = LIVE_TOKEN ? describe : describe.skip;

const PAIRS: Array<[list: string, gets: string[]]> = [
  ["sc_search_inspections", ["sc_get_inspection", "sc_get_inspection_answers"]],
  ["sc_list_templates", ["sc_get_template"]],
  ["sc_list_response_sets", ["sc_get_response_set"]],
  ["sc_list_issues", ["sc_get_issue", "sc_get_issue_timeline"]],
  ["sc_list_investigations", ["sc_get_investigation"]],
  ["sc_list_assets", ["sc_get_asset", "sc_get_asset_maintenance"]],
  ["sc_list_sites", ["sc_get_site", "sc_list_site_members"]],
  ["sc_search_users", ["sc_get_user"]],
  ["sc_list_groups", ["sc_list_group_members"]],
  ["sc_list_schedules", ["sc_get_schedule"]],
  ["sc_list_courses", ["sc_get_course"]],
  ["sc_list_heads_ups", ["sc_get_heads_up"]],
  ["sc_list_companies", ["sc_get_company", "sc_list_company_documents"]],
];

function firstId(data: unknown): string | undefined {
  const stack = [data];
  while (stack.length) {
    const v = stack.shift();
    if (Array.isArray(v)) {
      const hit = v.find((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string");
      if (hit) return (hit as { id: string }).id;
      stack.push(...v);
    } else if (v && typeof v === "object") stack.push(...Object.values(v));
  }
  return undefined;
}

d("live list -> get", () => {
  let c: Awaited<ReturnType<typeof liveClient>>;
  let required: Map<string, string>;
  const log: string[] = [];
  beforeAll(async () => {
    c = await liveClient("read-only");
    const tools = (await c.client.listTools()).tools;
    required = new Map(tools.map((t) => [t.name, (t.inputSchema.required ?? [])[0] as string]));
  });
  afterAll(async () => {
    console.log(log.join("\n"));
    await c.close();
  });

  it("every get tool works on a real id", async () => {
    const bugs: string[] = [];
    for (const [list, gets] of PAIRS) {
      const l = await c.call(list, { limit: 5 });
      const id = l.isError ? undefined : firstId(l.data);
      if (!id) {
        log.push(`${list.padEnd(28)} no records (skipped ${gets.join(", ")})`);
        continue;
      }
      for (const g of gets) {
        const arg = required.get(g);
        const r = await c.call(g, arg ? { [arg]: id } : {});
        const bug = r.isError && !/Mitti API (403|404)/.test(r.text);
        log.push(`${g.padEnd(36)} ${shape(r)}${bug ? ` [BUG] ${r.text.slice(0, 700)}` : ""}`);
        if (bug) bugs.push(g);
      }
    }
    expect(bugs).toEqual([]);
  });
});
