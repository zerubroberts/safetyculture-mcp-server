import { describe, expect, it } from "vitest";
import { analyzeCredentialRadar, bucketForDays } from "../../src/analytics/credentials.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T12:00:00Z"); // today = 2026-10-08

const cred = (id: string, user: string, first: string, type: string, expiry: string, extra: Record<string, unknown> = {}) => ({
  document_id: id,
  document_version_id: `${id}-v1`,
  document_type_id: `type-${type.toLowerCase().replace(/\s+/g, "-")}`,
  document_type_name: type,
  subject_user_id: user,
  subject_user_first_name: first,
  subject_user_last_name: first ? "Demo" : "",
  expiry_date: expiry,
  approval_status: "APPROVED",
  modified_at: "2026-09-01T00:00:00Z",
  deleted: false,
  ...extra,
});

function fixture() {
  return new FakeCache()
    .seed("credentials", [
      cred("d1", "user_a", "Alex", "First Aid", "2026-10-07"), // -1: expired
      cred("d2", "user_a", "Alex", "Forklift", "2026-10-08"), // 0: expires today, not expired
      cred("d3", "user_b", "Blair", "First Aid", "2026-10-15"), // 7
      cred("d3", "user_b", "Blair", "First Aid", "2026-10-01", { modified_at: "2026-01-01T00:00:00Z" }), // older version of d3
      cred("d4", "user_b", "Blair", "Forklift", "2026-10-16", { approval_status: "PENDING" }), // 8
      cred("d5", "user_c", "", "White Card", "2026-11-07"), // 30, name from users feed
      cred("d6", "user_c", "", "Working at Heights", "2026-11-08"), // 31: beyond a 30-day horizon
      cred("d7", "user_d", "Dana", "First Aid", "2026-01-01"), // superseded by d8
      cred("d8", "user_d", "Dana", "First Aid", "2027-03-01"),
      cred("d9", "user_e", "Erin", "First Aid", ""), // no expiry
      cred("d10", "user_e", "Erin", "Forklift", "2026-10-09", { deleted: true }),
    ])
    .seed("users", [{ id: "user_c", firstname: "Casey", lastname: "Demo" }]);
}

describe("analyzeCredentialRadar", () => {
  it("buckets by days left with exact boundaries and the default 30-day horizon", () => {
    const { result, summary } = analyzeCredentialRadar(fixture(), {}, NOW);
    expect(result.table.map((r) => [r.document_id, r.days_left, r.bucket])).toEqual([
      ["d1", -1, "expired"],
      ["d2", 0, "within_7_days"],
      ["d3", 7, "within_7_days"],
      ["d4", 8, "within_30_days"],
      ["d5", 30, "within_30_days"],
    ]);
    expect(result.metrics).toMatchObject({ expired: 1, within_7_days: 2, within_30_days: 2, within_90_days: 0, listed: 5, beyond_horizon: 2, no_expiry_date: 1, people: 3 });
    expect(result.table[4]!.person).toBe("Casey Demo");
    expect(summary).toContain("1 expired, 2 within 7 days, 2 within 8-30 days");
    expect(result.caveats.some((c) => c.startsWith("1 older credentials were superseded"))).toBe(true);
    expect(result.caveats.some((c) => c.startsWith("1 deleted credential"))).toBe(true);
    expect(result.caveats.some((c) => c.startsWith("1 listed credentials are not yet approved"))).toBe(true);
  });

  it("groups by person and by type", () => {
    const { result } = analyzeCredentialRadar(fixture(), {}, NOW);
    expect(result.by_person.map((p) => [p.person, p.expired, p.within_7_days, p.within_30_days, p.total])).toEqual([
      ["Alex Demo", 1, 1, 0, 2],
      ["Blair Demo", 0, 1, 1, 2],
      ["Casey Demo", 0, 0, 1, 1],
    ]);
    expect(result.by_type.map((t) => [t.credential_type, t.expired, t.within_7_days, t.within_30_days])).toEqual([
      ["First Aid", 1, 1, 0],
      ["Forklift", 0, 1, 1],
      ["White Card", 0, 0, 1],
    ]);
  });

  it("wider horizon, type filter and include_expired=false", () => {
    expect(analyzeCredentialRadar(fixture(), { horizon: "next 90 days" }, NOW).result.metrics).toMatchObject({ within_90_days: 1, listed: 6, beyond_horizon: 1 });
    expect(analyzeCredentialRadar(fixture(), { credential_types: ["first aid"] }, NOW).result.table.map((r) => r.document_id)).toEqual(["d1", "d3"]);
    const noExpired = analyzeCredentialRadar(fixture(), { include_expired: false }, NOW).result;
    expect(noExpired.metrics).toMatchObject({ expired: 0, listed: 4 });
    expect(noExpired.caveats.some((c) => c.startsWith("1 expired credentials are hidden"))).toBe(true);
  });

  it("synced, empty feed is a true zero", () => {
    const { summary, result } = analyzeCredentialRadar(new FakeCache().seed("credentials", []).seed("users", []), {}, NOW);
    expect(summary).toMatch(/^No credentials are recorded/);
    expect(result.metrics.expired).toBe(0);
    expect(result.total).toBe(0);
    expect(result.table).toEqual([]);
  });

  it("bucket edges", () => {
    expect([-1, 0, 7, 8, 30, 31, 90, 91].map(bucketForDays)).toEqual([
      "expired",
      "within_7_days",
      "within_7_days",
      "within_30_days",
      "within_30_days",
      "within_90_days",
      "within_90_days",
      "later",
    ]);
  });

  it("caps the table and rollups at limit, most urgent first, with counts over the full set", () => {
    const rows = Array.from({ length: 70 }, (_, k) =>
      // 70 people, each one First Aid credential expiring k - 10 days from today (10 already expired).
      cred(`dx${k}`, `user_${k}`, `Person${String(k).padStart(2, "0")}`, "First Aid", new Date(Date.UTC(2026, 9, 8 + k - 10)).toISOString().slice(0, 10)),
    );
    const cache = new FakeCache().seed("credentials", rows).seed("users", []);
    const { result, summary } = analyzeCredentialRadar(cache, { horizon: "next 90 days" }, NOW);
    expect(result.table).toHaveLength(50);
    expect(result).toMatchObject({ total: 70, truncated: true });
    expect(result.metrics).toMatchObject({ expired: 10, listed: 70, people: 70 });
    expect(result.table[0]).toMatchObject({ days_left: -10, bucket: "expired" });
    expect(result.table[49]!.days_left).toBe(39);
    expect(result.by_person).toHaveLength(50);
    expect(result.by_person.slice(0, 10).every((p) => p.expired === 1)).toBe(true);
    expect(result.by_type).toEqual([expect.objectContaining({ credential_type: "First Aid", expired: 10, total: 70 })]);
    expect(result.caveats.some((c) => c.includes("Showing the 50 most urgent credentials"))).toBe(true);
    expect(summary).toContain("70 credentials need attention");
    expect(analyzeCredentialRadar(cache, { horizon: "next 90 days", limit: 3 }, NOW).result.table.map((r) => r.days_left)).toEqual([-10, -9, -8]);
  });
});
