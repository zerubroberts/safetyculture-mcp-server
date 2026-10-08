import { describe, expect, it } from "vitest";
import { LIVE_TOKEN, LIVE_WRITES, liveClient, TEST_PREFIX } from "./helpers.js";

// Opt-in (SC_LIVE_WRITE_TESTS=true). Creates ONE clearly-labelled action, updates it, then deletes
// it through the two-step confirm flow. Leaves nothing behind; the finally block cleans up.
const d = LIVE_TOKEN && LIVE_WRITES ? describe : describe.skip;

d("live write cycle (tiny, self-cleaning)", () => {
  it("create -> update -> dry-run delete -> confirmed delete", async () => {
    const c = await liveClient("full");
    let id: string | undefined;
    try {
      const created = await c.call("sc_create_action", {
        title: `${TEST_PREFIX} safetyculture-mcp automated test ${new Date().toISOString()}`,
        description: "Created by the safetyculture-mcp live test suite. Safe to delete.",
        priority: "low",
        reason: "automated live test",
      });
      expect(created.isError, created.text.slice(0, 200)).toBe(false);
      id = created.data.id as string;
      expect(id).toBeTruthy();

      const updated = await c.call("sc_update_action", { action_id: id, status: "in_progress", priority: "medium" });
      expect(updated.isError).toBe(false);
      expect(updated.data.changed).toEqual(["status", "priority"]);

      const got = await c.call("sc_get_action", { action_id: id });
      expect(got.data.status).toBe("in_progress");
      expect(got.data.priority).toBe("medium");

      const dry = await c.call("sc_delete_actions", { action_ids: [id] });
      expect(dry.text).toContain("DRY RUN");
      const token = dry.text.match(/confirm_token="([^"]+)"/)?.[1];
      expect(token).toBeTruthy();
      const del = await c.call("sc_delete_actions", { action_ids: [id], confirm_token: token });
      expect(del.isError).toBe(false);
      id = undefined;
    } finally {
      if (id) {
        // Best-effort cleanup if an assertion failed mid-way.
        const dry = await c.call("sc_delete_actions", { action_ids: [id] });
        const token = dry.text.match(/confirm_token="([^"]+)"/)?.[1];
        if (token) await c.call("sc_delete_actions", { action_ids: [id], confirm_token: token });
      }
      await c.close();
    }
  });
});
