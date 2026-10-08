import { describe, expect, it } from "vitest";
import type { FeedName } from "../../src/cache/contract.js";
import type { ToolContext } from "../../src/core/registry.js";
import { analyticsTools } from "../../src/toolsets/analytics.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z");

function ctxWith(cache: FakeCache) {
  const ensured: FeedName[][] = [];
  const ctx = {
    now: () => NOW,
    cache: {
      open: async () => {
        throw new Error("not used");
      },
      ensure: async (feeds: FeedName[]) => {
        ensured.push(feeds);
        return cache;
      },
    },
  } as unknown as ToolContext;
  return { ctx, ensured };
}

const tool = (name: string) => analyticsTools.find((t) => t.name === name)!;

describe("analytics toolset", () => {
  it("exposes the seven core analytics tools, all read-only", () => {
    expect(analyticsTools.map((t) => [t.name, Boolean(t.core)])).toEqual([
      ["sc_safety_pulse", true],
      ["sc_analyze_failed_items", true],
      ["sc_analyze_action_backlog", true],
      ["sc_analyze_schedule_compliance", true],
      ["sc_analyze_credential_radar", true],
      ["sc_analyze_site_league", false],
      ["sc_analyze_compare", false],
    ]);
    expect(analyticsTools.every((t) => t.access === "read" && t.toolset === "analytics")).toBe(true);
  });

  it("syncs the feeds it needs, then returns summary + AnalyticResult marked untrusted", async () => {
    const cache = new FakeCache().seed("credentials", []).seed("users", []);
    const { ctx, ensured } = ctxWith(cache);
    const out = await tool("sc_analyze_credential_radar").run({}, ctx);
    expect(ensured).toEqual([["credentials", "users"]]);
    expect(out.summary).toMatch(/^No credentials are recorded/);
    expect(out.untrusted).toBe(true);
    expect(out.data).toMatchObject({ metric_version: "credential-radar/1", as_of: NOW.toISOString() });
  });

  it("every tool runs on an empty cache without throwing and reports coverage caveats", async () => {
    for (const t of analyticsTools) {
      const { ctx } = ctxWith(new FakeCache());
      const out = await t.run({}, ctx);
      const data = out.data as { caveats: string[]; coverage: unknown[] };
      expect(data.coverage.length, t.name).toBeGreaterThan(0);
      expect(data.caveats.some((c) => c.includes("never been synced")), t.name).toBe(true);
      expect(out.summary, t.name).toContain("Caveats:");
    }
  });
});
