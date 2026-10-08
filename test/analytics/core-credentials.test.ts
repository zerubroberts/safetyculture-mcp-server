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

  it("empty feed says so", () => {
    const { summary, result } = analyzeCredentialRadar(new FakeCache().seed("credentials", []).seed("users", []), {}, NOW);
    expect(summary).toMatch(/^No credential data/);
    expect(result.metrics.expired).toBeNull();
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
});
