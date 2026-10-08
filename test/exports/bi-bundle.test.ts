import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dateDimension, powerQueryScript, qlikScript, TABLES, writeBiBundle } from "../../src/exports/bi-bundle.js";
import { parseCsv } from "../../src/exports/csv.js";
import { parsePeriod } from "../../src/core/time.js";
import { FakeCache } from "../helpers/fake-cache.js";

const NOW = new Date("2026-10-08T00:00:00Z");

// Synthetic organisation: 2 sites, 2 templates, 2 users.
function seeded(): FakeCache {
  return new FakeCache()
    .seed("sites", [
      { id: "site-1", name: "Demo Depot", meta_label: "location", parent_id: "site-r", deleted: false },
      { id: "site-r", name: "Demo Region", meta_label: "region", deleted: false },
    ])
    .seed("templates", [
      { id: "template_1", name: "Forklift check", archived: false, created_at: "2026-01-01T00:00:00Z" },
      { id: "template_2", name: "Site walk, \"weekly\"", archived: true },
    ])
    .seed("users", [
      { id: "user_1", firstname: "Alex", lastname: "Demo", email: "alex@example.com", active: true },
      { id: "user_2", firstname: "Sam", lastname: "Demo", email: "sam@example.com", active: false },
    ])
    .seed("inspections", [
      { id: "audit_1", name: "=HYPERLINK(\"x\")", template_id: "template_1", site_id: "site-1", owner_id: "user_1", conducted_on: "2026-09-01T09:00:00Z", date_completed: "2026-09-01T10:00:00Z", score: 8, max_score: 10, score_percentage: 80, archived: false },
      { id: "audit_2", name: "Line1\nLine2", template_id: "template_2", site_id: "site-1", owner_id: "user_2", date_started: "2026-09-03T09:00:00Z", archived: true },
      { id: "audit_3", name: "Old", template_id: "template_1", site_id: "site-1", owner_id: "user_1", conducted_on: "2025-01-01T09:00:00Z" },
    ])
    .seed("inspection_items", [
      { id: "audit_1_i1", audit_id: "audit_1", item_id: "i1", label: "Brakes ok?", response: "No", is_failed_response: true, score: 0, max_score: 1 },
      { id: "audit_1_i2", audit_id: "audit_1", item_id: "i2", label: "Horn, lights", response: "Yes", is_failed_response: false, score: 1, max_score: 1 },
      { id: "audit_2_i1", audit_id: "audit_2", item_id: "i1", label: "Brakes ok?", response: "", is_failed_response: false },
      { id: "audit_3_i1", audit_id: "audit_3", item_id: "i1", label: "Brakes ok?", response: "Yes" },
    ])
    .seed("actions", [
      { id: "act-1", title: "Fix brakes", status: "To do", priority: "High", site_id: "site-1", audit_id: "audit_1", creator_user_id: "user_1", created_at: "2026-09-01T11:00:00Z", due_date: "2026-09-05T00:00:00Z" },
      { id: "act-2", title: "+ order parts", status: "Complete", site_id: "site-1", created_at: "2026-09-02T11:00:00Z", completed_at: "2026-09-04T00:00:00Z" },
    ])
    .seed("issues", [{ id: "iss-1", title: "Spill, aisle 3", status: "Open", site_id: "site-1", creator_id: "user_2", occurred_at: "2026-09-02T08:00:00Z", created_at: "2026-09-02T09:00:00Z" }])
    .seed("schedules", [{ id: "sch-1", site_ids: ["site-1"], template_id: "template_1" }])
    .seed("schedule_occurrences", [
      { id: "occ-1", schedule_id: "sch-1", template_id: "template_1", due_time: "2026-09-01T17:00:00Z", occurrence_status: "COMPLETED", audit_id: "audit_1" },
      { id: "occ-2", schedule_id: "sch-1", template_id: "template_1", due_time: "2026-09-02T17:00:00Z", occurrence_status: "MISSED" },
    ]);
}

const csvRows = (dir: string, table: string) => parseCsv(readFileSync(join(dir, `${table}.csv`), "utf8"));

describe("BI bundle", () => {
  it("manifest row counts equal the CSV row counts for every table", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-bi-"));
    const res = writeBiBundle(seeded(), { dir, pii: "contact", now: NOW });
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.tables.map((t: { name: string }) => t.name)).toEqual(TABLES.map((t) => t.name));
    for (const t of manifest.tables as Array<{ name: string; rows: number; columns: Array<{ name: string }> }>) {
      const rows = csvRows(dir, t.name);
      expect(rows[0]).toEqual(t.columns.map((c) => c.name));
      expect(rows.length - 1, t.name).toBe(t.rows);
    }
    expect(res.manifest.tables.find((t) => t.name === "fact_inspections")!.rows).toBe(3);
    expect(res.manifest.tables.find((t) => t.name === "fact_inspection_items")!.rows).toBe(4);
    expect(res.files).toEqual(expect.arrayContaining(["manifest.json", "powerbi.pq", "qlik.qvs", "README.md"]));
  });

  it("writes typed, safe values: flags, UTC timestamps, date keys, neutralised text", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-bi-"));
    writeBiBundle(seeded(), { dir, pii: "contact", now: NOW });
    const [head, ...rows] = csvRows(dir, "fact_inspections");
    const r1 = Object.fromEntries(head!.map((h, i) => [h, rows[0]![i]]));
    expect(r1).toMatchObject({
      inspection_id: "audit_1",
      date_key: "20260901",
      conducted_at: "2026-09-01 09:00:00",
      inspection_is_completed: "1",
      inspection_is_archived: "0",
      inspection_score_pct: "80",
      inspection_name: `'=HYPERLINK("x")`,
    });
    const items = csvRows(dir, "fact_inspection_items");
    const failedIdx = items[0]!.indexOf("item_is_failed");
    expect(items.slice(1).map((r) => r[failedIdx])).toEqual(["1", "0", "0", "0"]);
    const actions = csvRows(dir, "fact_actions");
    const a = (row: string[]) => Object.fromEntries(actions[0]!.map((h, i) => [h, row[i]]));
    expect(a(actions[1]!)).toMatchObject({ action_is_open: "1", action_is_overdue: "1", inspection_id: "audit_1" });
    expect(a(actions[2]!)).toMatchObject({ action_is_open: "0", action_is_overdue: "0", action_title: "'+ order parts" });
    const occ = csvRows(dir, "fact_schedule_occurrences");
    const siteIdx = occ[0]!.indexOf("site_id");
    expect(occ.slice(1).map((r) => r[siteIdx])).toEqual(["site-1", "site-1"]);
    const sites = csvRows(dir, "dim_sites");
    expect(sites[1]).toEqual(["site-1", "Demo Depot", "location", "site-r", "Demo Region", "0"]);
  });

  it("pseudonymises dim_users per privacy level", () => {
    const users = (pii: "none" | "contact" | "strict") => {
      const dir = mkdtempSync(join(tmpdir(), "scmcp-bi-"));
      writeBiBundle(seeded(), { dir, pii, now: NOW });
      return csvRows(dir, "dim_users")[1]!;
    };
    expect(users("none").slice(0, 3)).toEqual(["user_1", "Alex Demo", "alex@example.com"]);
    const contact = users("contact");
    expect(contact[1]).toBe("Alex Demo");
    expect(contact[2]).toMatch(/^email_/);
    const strict = users("strict");
    expect(strict[1]).toMatch(/^person_/);
    expect(strict[2]).toMatch(/^email_/);
  });

  it("filters facts by period but keeps dimensions complete", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-bi-"));
    const res = writeBiBundle(seeded(), { dir, pii: "contact", now: NOW, period: parsePeriod("2026-09", NOW) });
    const rows = Object.fromEntries(res.manifest.tables.map((t) => [t.name, t.rows]));
    expect(rows).toMatchObject({ fact_inspections: 2, fact_inspection_items: 3, dim_sites: 2, dim_users: 2, dim_templates: 2 });
    // dim_date spans 2026-09-01 .. 2026-09-03 (earliest to latest fact date).
    expect(rows.dim_date).toBe(3);
  });

  it("dim_date is continuous with ISO weeks", () => {
    const days = dateDimension([20241230, 20250105]);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ date_key: 20241230, iso_year: 2025, iso_week: 1, day_of_week: 1, day_name: "Monday" });
    expect(days[6]).toMatchObject({ date_key: 20250105, is_weekend: true, day_of_week: 7 });
  });

  it("load scripts reference every table; Qlik concatenates facts with fact_type", () => {
    const m = powerQueryScript();
    const q = qlikScript();
    for (const t of TABLES) {
      expect(m).toContain(`// ==== Query: ${t.name} ====`);
      expect(q).toContain(`${t.name}.csv`);
    }
    expect(m).toContain("fact_actions[inspection_id] many-to-one fact_inspections[inspection_id]  (INACTIVE)");
    expect(q).toContain("Concatenate ([Facts])");
    expect(q).toContain("[inspector_user_id] AS [user_id]");
    expect(q.match(/^\[Facts\]:/gm)).toHaveLength(1);
  });
});
