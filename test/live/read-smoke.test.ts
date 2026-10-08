import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIVE_TOKEN, liveClient, shape } from "./helpers.js";

// Calls every read tool that needs no ID with default arguments, then ID-taking tools using an
// ID found by a list tool. Asserts "no error" (or a documented licence/permission error) only.
const d = LIVE_TOKEN ? describe : describe.skip;

// Errors that mean "this org has not licensed / enabled the module": acceptable in a smoke test.
const MODULE_UNAVAILABLE = /Mitti API (403|404)|not (enabled|licensed)|permission/i;

d("live read-only smoke", () => {
  let c: Awaited<ReturnType<typeof liveClient>>;
  const results: Array<[string, string]> = [];
  beforeAll(async () => {
    c = await liveClient("read-only");
  });
  afterAll(async () => {
    // Content-free summary only.
    console.log(results.map(([n, s]) => `${n.padEnd(36)} ${s}`).join("\n"));
    await c.close();
  });

  it("exposes no write tools in read-only mode", async () => {
    const tools = (await c.client.listTools()).tools;
    expect(tools.length).toBeGreaterThan(20);
    for (const t of tools) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
  });

  it("every no-argument read tool succeeds or reports an unlicensed module", async () => {
    const tools = (await c.client.listTools()).tools.filter((t) => !(t.inputSchema.required ?? []).length);
    const skip = new Set(["sc_enable_toolsets", "sc_query_cache"]);
    for (const t of tools) {
      if (skip.has(t.name)) continue;
      const r = await c.call(t.name, {});
      results.push([t.name, shape(r)]);
      if (r.isError) expect(r.text, t.name).toMatch(MODULE_UNAVAILABLE);
    }
  });

  it("never leaks the token or support hashes", async () => {
    const r = await c.call("sc_whoami");
    expect(r.isError).toBe(false);
    expect(r.text).not.toContain(LIVE_TOKEN!);
    expect(r.text).not.toMatch(/intercom|kustomer/i);
    expect(r.text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // strict PII: no raw emails
  });

  it("get-by-id tools work with an id from the list tool", async () => {
    const list = await c.call("sc_list_actions", { limit: 1 });
    expect(list.isError).toBe(false);
    const id = list.data?.actions?.[0]?.id;
    if (!id) return;
    const one = await c.call("sc_get_action", { action_id: id });
    results.push(["sc_get_action", shape(one)]);
    expect(one.isError).toBe(false);
  });
});
