import { describe, expect, it } from "vitest";
import type { CacheReader, FeedName, FeedStatus } from "../../src/cache/contract.js";
import { buildResult, coverage, coverageCaveats } from "../../src/analytics/common.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");

const reader = (statuses: Array<Partial<FeedStatus> & { feed: FeedName }>): CacheReader => ({
  rows: () => [],
  status: (feeds) =>
    statuses
      .filter((s) => !feeds || feeds.includes(s.feed))
      .map((s) => ({ rows: 10, last_synced_at: "2026-10-08T11:30:00.000Z", watermark: null, complete: true, last_error: null, ...s })),
});

describe("coverage and caveats", () => {
  it("a failed refresh of a complete snapshot is not reported complete and gets a caveat with its age", () => {
    const cache = reader([{ feed: "inspections", last_synced_at: "2026-10-01T12:00:00.000Z", last_error: "Mitti API 500: server error" }]);
    const [c] = coverage(cache, ["inspections"], NOW);
    expect(c).toMatchObject({ feed: "inspections", complete: false, last_error: "Mitti API 500: server error", age_minutes: 7 * 1440 });
    const caveats = coverageCaveats([c!]);
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toMatch(/latest refresh of feed "inspections" failed \(Mitti API 500: server error\).*7 days ago.*out of date/);
  });

  it("says plainly when a feed is unavailable, with or without previously cached rows", () => {
    const cache = reader([
      { feed: "credentials", rows: 0, unavailable: "HTTP 403: module not enabled" },
      { feed: "actions", rows: 4, complete: false, unavailable: "HTTP 403: no permission", last_error: "Access refused on refresh" },
    ]);
    const cov = coverage(cache, ["credentials", "actions"], NOW);
    expect(cov[0]).toMatchObject({ unavailable: "HTTP 403: module not enabled", complete: true });
    expect(cov[1]).toMatchObject({ unavailable: "HTTP 403: no permission", complete: false });
    const caveats = coverageCaveats(cov);
    expect(caveats[0]).toMatch(/"credentials" is unavailable to this API token \(HTTP 403: module not enabled\).*missing, not zero/);
    expect(caveats[1]).toMatch(/"actions" is no longer accessible.*4 cached rows.*not current/);
    expect(caveats).toHaveLength(2);
  });

  it("flags a feed older than the freshness window even without an error", () => {
    const cache = reader([
      { feed: "sites", last_synced_at: "2026-10-08T09:00:00.000Z" },
      { feed: "users", last_synced_at: "2026-10-08T11:30:00.000Z" },
    ]);
    const res = buildResult({ version: "t", filters: {}, cache, feeds: ["sites", "users"], metrics: {}, table: [], method: "", now: NOW });
    expect(res.coverage.map((c) => c.age_minutes)).toEqual([180, 30]);
    expect(res.caveats).toEqual([expect.stringMatching(/"sites" was last synced 3 hours ago, older than its 60-minute freshness window/)]);
  });

  it("without a clock, coverage omits age and adds no staleness caveat", () => {
    const cov = coverage(reader([{ feed: "sites", last_synced_at: "2020-01-01T00:00:00.000Z" }]), ["sites"]);
    expect(cov[0]!.age_minutes).toBeUndefined();
    expect(coverageCaveats(cov)).toEqual([]);
  });
});
