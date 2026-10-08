import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, modeAllows } from "../../src/core/config.js";
import { parsePeriod, previousPeriod } from "../../src/core/time.js";

const now = new Date("2026-10-08T03:00:00Z"); // a Thursday

describe("parsePeriod", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  it.each([
    ["last 30 days", "2026-09-09", "2026-10-09"],
    ["7d", "2026-10-02", "2026-10-09"],
    ["last week", "2026-09-28", "2026-10-05"],
    ["this month", "2026-10-01", "2026-10-09"],
    ["last month", "2026-09-01", "2026-10-01"],
    ["last quarter", "2026-07-01", "2026-10-01"],
    ["2026-Q3", "2026-07-01", "2026-10-01"],
    ["2026-07", "2026-07-01", "2026-08-01"],
    ["ytd", "2026-01-01", "2026-10-09"],
    ["2026-07-01..2026-09-30", "2026-07-01", "2026-10-01"],
    ["next 14 days", "2026-10-08", "2026-10-23"],
  ])("%s", (input, from, to) => {
    const p = parsePeriod(input, now);
    expect([iso(p.from), iso(p.to)]).toEqual([from, to]);
  });

  it.each([
    // [now, input, from, to (exclusive)]: month/year shifts clamp to the last valid day, never overflow.
    ["2026-05-31T03:00:00Z", "last 1 month", "2026-05-01", "2026-06-01"],
    ["2026-03-31T03:00:00Z", "last 1 month", "2026-03-01", "2026-04-01"],
    ["2026-10-08T03:00:00Z", "6m", "2026-04-09", "2026-10-09"],
    ["2024-02-29T03:00:00Z", "last 1 year", "2023-03-01", "2024-03-01"],
    ["2026-01-31T03:00:00Z", "next 1 month", "2026-01-31", "2026-03-01"],
  ])("rolling months/years clamp the day: on %s, %s", (at, input, from, to) => {
    const p = parsePeriod(input, new Date(at));
    expect([iso(p.from), iso(p.to)]).toEqual([from, to]);
  });

  it("rejects nonsense with a helpful message", () => {
    expect(() => parsePeriod("whenever", now)).toThrow(/Try "last 30 days"/);
  });

  it("previous period has equal length and ends where the current starts", () => {
    const p = parsePeriod("2026-Q3", now);
    const q = previousPeriod(p);
    expect(q.to.getTime()).toBe(p.from.getTime());
    expect(p.to.getTime() - p.from.getTime()).toBe(q.to.getTime() - q.from.getTime());
  });
});

describe("config", () => {
  it("defaults to read-only, contact-level privacy and the Mitti host", () => {
    const c = loadConfig({ SC_API_TOKEN: "scapi_xxxxxxxxxxxx" });
    expect(c.mode).toBe("read-only");
    expect(c.pii).toBe("contact");
    expect(c.baseUrl).toBe("https://api.mitti.com");
    expect(c.toolsets).toEqual(["default"]);
  });

  it("accepts the friendly write flags", () => {
    expect(loadConfig({ SC_API_TOKEN: "scapi_xxxxxxxxxxxx", SC_ENABLE_WRITES: "true" }).mode).toBe("write");
    expect(loadConfig({ SC_API_TOKEN: "scapi_xxxxxxxxxxxx", SC_ENABLE_DESTRUCTIVE: "1" }).mode).toBe("full");
  });

  it("requires a token and https", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ SC_API_TOKEN: "scapi_xxxxxxxxxxxx", SC_API_BASE_URL: "http://api.mitti.com" })).toThrow(/https/);
  });

  it("mode gates", () => {
    expect(modeAllows("read-only", "write")).toBe(false);
    expect(modeAllows("write", "destructive")).toBe(false);
    expect(modeAllows("full", "destructive")).toBe(true);
  });
});
