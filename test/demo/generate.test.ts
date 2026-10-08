import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeAnomalies } from "../../src/analytics/anomalies.js";
import { isOverdue, loadActions } from "../../src/analytics/backlog.js";
import { analyzeCredentialRadar } from "../../src/analytics/credentials.js";
import { analyzeFailedItems, completedInspections, failedRate } from "../../src/analytics/failed-items.js";
import { analyzeSiteLeague } from "../../src/analytics/league.js";
import { safetyPulse } from "../../src/analytics/pulse.js";
import type { FeedName } from "../../src/cache/contract.js";
import { parsePeriod } from "../../src/core/time.js";
import { createDemoFetch } from "../../src/demo/fetch.js";
import { demoAnchor, generateDemoOrg, IMPROVING_SITE, WORST_SITES } from "../../src/demo/generate.js";
import { FakeCache } from "../helpers/fake-cache.js";

const ANCHOR = Date.UTC(2026, 9, 8);
const NOW = new Date(ANCHOR);
const org = generateDemoOrg(ANCHOR);
const cache = new FakeCache();
for (const [feed, rows] of Object.entries(org.feeds)) cache.seed(feed as FeedName, rows);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

describe("demo generator", () => {
  it("is deterministic for a fixed anchor date", () => {
    expect(hash(generateDemoOrg(ANCHOR))).toBe(hash(org));
    const next = generateDemoOrg(ANCHOR + 86_400_000);
    expect(next.feeds.users.map((u) => u.id)).toEqual(org.feeds.users.map((u) => u.id)); // stable people and sites
    expect(next.feeds.sites.map((s) => s.id)).toEqual(org.feeds.sites.map((s) => s.id));
    expect(next.orgId).not.toBe(org.orgId); // one cache file per day
    expect(org.feeds.inspections.every((i) => Date.parse(String(i.date_started)) < ANCHOR)).toBe(true);
    expect(demoAnchor(new Date("2026-10-08T21:30:00Z"))).toBe(ANCHOR);
  });

  it("has the documented scale and real ID formats", () => {
    const f = org.feeds;
    expect(f.sites.filter((s) => s.meta_label === "site")).toHaveLength(12);
    expect(f.sites.filter((s) => s.meta_label === "region")).toHaveLength(3);
    expect(f.users).toHaveLength(60);
    expect(f.groups).toHaveLength(8);
    expect(org.templates).toHaveLength(10);
    for (const t of org.templates) expect(t.items.length).toBeGreaterThanOrEqual(12), expect(t.items.length).toBeLessThanOrEqual(30);
    expect(f.inspections.length).toBeGreaterThan(1650);
    expect(f.inspections.length).toBeLessThan(1950);
    expect(f.actions.length).toBeGreaterThan(400);
    expect(f.actions.length).toBeLessThan(500);
    expect(f.issues).toHaveLength(120);
    expect(new Set(f.issues.map((i) => i.category_id)).size).toBe(8);
    expect(f.credentials).toHaveLength(150);
    expect(f.contractor_companies).toHaveLength(6);
    expect(org.assets).toHaveLength(40);
    expect(new Set(org.assets.map((a) => a._type)).size).toBe(6);
    expect(org.courses).toHaveLength(6);
    expect(org.headsUps).toHaveLength(5);
    expect(f.inspections.every((i) => /^audit_[0-9a-f]{32}$/.test(String(i.id)))).toBe(true);
    expect(org.templates.every((t) => /^template_[0-9a-f]{32}$/.test(t.id))).toBe(true);
    expect(f.users.every((u) => /^user_[0-9a-f]{32}$/.test(String(u.id)) && /@northwind-facilities\.example\.com$/.test(String(u.email)))).toBe(true);
    expect(f.actions.every((a) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(String(a.id)))).toBe(true);
    expect(f.inspections.some((i) => i.archived)).toBe(true);
    expect(f.schedule_occurrences.some((o) => o.occurrence_status === "MISSED")).toBe(true);
    expect(f.schedule_occurrences.some((o) => o.occurrence_status === "LATE")).toBe(true);
    // Every completed action has a matching completion event in its timeline.
    const events = new Set(f.action_timeline_items.filter((t) => t.item_type === "TASK_STATUS_UPDATED").map((t) => t.task_id));
    expect(f.actions.filter((a) => a.completed_at).every((a) => events.has(a.id))).toBe(true);
  });

  it("keeps headline analytics stable", () => {
    const last30 = completedInspections(cache, parsePeriod("last 30 days", NOW));
    const rate = failedRate(cache, completedInspections(cache, parsePeriod("last 90 days", NOW)));
    const overdue = loadActions(cache).filter((a) => isOverdue(a, ANCHOR)).length;
    expect({ inspections_last_30_days: last30.size, failed_item_rate_90d_pct: rate.rate_pct, overdue_actions: overdue }).toEqual(HEADLINES);
  });

  it("gives every hero analytic something to say", () => {
    const pulse = safetyPulse(cache, {}, NOW).result.table;
    const moved = pulse.filter((r) => r.direction === "up" || r.direction === "down").map((r) => r.metric);
    expect(moved).toEqual(expect.arrayContaining(["inspections_completed", "average_score", "failed_item_rate"]));

    const pareto = analyzeFailedItems(cache, {}, NOW).result.table.slice(0, 5).map((r) => (r as { group: string }).group);
    expect(new Set(pareto)).toEqual(new Set(["Fire extinguisher tag current", "Emergency exits clear and unobstructed", "Correct PPE worn", "Housekeeping: walkways clear of debris", "Forklift horn working"]));

    const league = analyzeSiteLeague(cache, { period: "last 90 days" }, NOW).result.table;
    expect(WORST_SITES).toContain(league[league.length - 1]!.site);
    expect(WORST_SITES).toContain(league[league.length - 2]!.site);
    const improving = league.find((r) => r.site === IMPROVING_SITE)!;
    const early = analyzeSiteLeague(cache, { period: "2025-10-09..2026-01-08" }, NOW).result.table.find((r) => r.site === IMPROVING_SITE)!;
    expect(improving.failed_item_rate!).toBeLessThan(early.failed_item_rate! / 2);

    const radar = analyzeCredentialRadar(cache, {}, NOW).result.metrics;
    expect(Number(radar.within_7_days) + Number(radar.within_30_days)).toBeGreaterThanOrEqual(5);
    expect(Number(radar.expired)).toBeGreaterThanOrEqual(5);

    const flagged = computeAnomalies(cache, { kinds: ["too_fast", "perfect_streak", "duplicate_burst", "score_outlier"], period: parsePeriod("last 90 days", NOW) }, NOW).result.table;
    expect(new Set(flagged.map((r) => r.kind))).toEqual(new Set(["too_fast", "perfect_streak", "duplicate_burst"]));
  });
});

describe("demo fetch", () => {
  const demo = createDemoFetch({ anchor: ANCHOR });
  const get = async (path: string) => {
    const res = await demo(`https://demo.safetyculture-mcp.invalid${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it("pages feeds with metadata.next_page and next_page_token", async () => {
    const first = await get("/feed/inspections?archived=both&completed=both&limit=500");
    expect(first.body.data).toHaveLength(500);
    expect(first.body.metadata.next_page).toMatch(/^\/feed\/inspections\?.*next_page_token=500/);
    expect(first.body.metadata.next_page_token).toBe("500");
    let next = first.body.metadata.next_page as string | null;
    let total = first.body.data.length;
    while (next) {
      const page = await get(next);
      total += page.body.data.length;
      next = page.body.metadata.next_page;
    }
    expect(total).toBe(org.feeds.inspections.length);
    expect(Object.keys(first.body.data[0]).some((k) => k.startsWith("_"))).toBe(false);
  });

  it("applies the feed filters the tools send", async () => {
    const tpl = org.templates[3]!.id;
    const { body } = await get(`/feed/inspections?template=${tpl}&completed=both&limit=1000`);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((i: { template_id: string; archived: boolean }) => i.template_id === tpl && !i.archived)).toBe(true);
    const from = new Date(ANCHOR - 7 * 86_400_000).toISOString();
    const recent = await get(`/feed/inspections?modified_after=${from}&archived=both&completed=both&limit=1000`);
    expect(recent.body.data.every((i: { modified_at: string }) => i.modified_at > from)).toBe(true);
  });

  it("answers unknown routes with a 404 that names the route", async () => {
    const { status, body } = await get("/no/such/endpoint");
    expect(status).toBe(404);
    expect(body.message).toContain("GET /no/such/endpoint");
  });
});

// Snapshot for anchor 2026-10-08. A deliberate generator change updates these numbers; an accidental one fails here.
const HEADLINES = { inspections_last_30_days: 180, failed_item_rate_90d_pct: 4.83, overdue_actions: 40 };
