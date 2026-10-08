import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cellText, neutralise, parseCsv, toCsv, writeCsv } from "../../src/exports/csv.js";
import { applyPii } from "../../src/exports/pii.js";
import { filterRows, safeStem } from "../../src/exports/dataset.js";
import { parsePeriod } from "../../src/core/time.js";

const NONE = { pii: "none" } as const;

describe("CSV writer", () => {
  it("quotes commas, quotes and newlines (RFC 4180)", () => {
    const csv = toCsv([{ a: 'say "hi", ok', b: "line1\nline2", c: "plain", d: " padded " }], NONE);
    expect(csv).toBe('a,b,c,d\r\n"say ""hi"", ok","line1\nline2",plain," padded "\r\n');
    expect(parseCsv(csv)).toEqual([
      ["a", "b", "c", "d"],
      ['say "hi", ok', "line1\nline2", "plain", " padded "],
    ]);
  });

  it.each(["=SUM(A1:A2)", "+1+1", "-2+3", "@cmd", "\tTAB", "\rCR"])("neutralises formula-like text %j", (v) => {
    expect(neutralise(v)).toBe(`'${v}`);
    expect(cellText(v).startsWith("'")).toBe(true);
  });

  it("leaves numbers, booleans and safe text alone; flattens nested values to JSON", () => {
    expect(cellText(-5)).toBe("-5");
    expect(cellText(true)).toBe("true");
    expect(cellText(null)).toBe("");
    expect(cellText("Demo Depot")).toBe("Demo Depot");
    expect(cellText({ x: [1, 2] })).toBe('{"x":[1,2]}');
    const csv = toCsv([{ tags: ["a", "b"], meta: { k: "=1" } }], NONE);
    expect(parseCsv(csv)[1]).toEqual(['["a","b"]', '{"k":"=1"}']);
  });

  it("writes a UTF-8 BOM file whose parsed rows match the input, columns from all rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-csv-"));
    const path = join(dir, "x.csv");
    const n = writeCsv(path, [{ a: 1 }, { a: 2, b: "Zoë, Demo" }], NONE);
    const text = readFileSync(path, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(n).toBe(2);
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["1", ""],
      ["2", "Zoë, Demo"],
    ]);
  });
});

describe("dataset export helpers", () => {
  it("applies the privacy level by column name only", () => {
    const row = { id: "user_1", email: "alex@example.com", firstname: "Alex", expiry_date: "2026-10-08", phone_number: "+61 400 000 000", token: "x" };
    expect(applyPii(row, "none")).toEqual({ id: "user_1", email: "alex@example.com", firstname: "Alex", expiry_date: "2026-10-08", phone_number: "+61 400 000 000" });
    const contact = applyPii(row, "contact");
    expect(contact.email).toMatch(/^email_[0-9a-f]{10}$/);
    expect(contact.phone_number).toBe("[phone]");
    expect(contact.firstname).toBe("Alex");
    expect(contact.expiry_date).toBe("2026-10-08");
    expect(applyPii(row, "strict").firstname).toMatch(/^person_/);
  });

  it("filters by period, site (site_id or site_ids) and template", () => {
    const rows = [
      { id: 1, created_at: "2026-09-10T00:00:00Z", site_id: "site-1", template_id: "t1" },
      { id: 2, created_at: "2026-08-10T00:00:00Z", site_id: "site-1", template_id: "t1" },
      { id: 3, created_at: "2026-09-11T00:00:00Z", site_ids: ["site-2", "site-1"], template_id: "t2" },
      { id: 4, created_at: "2026-09-12T00:00:00Z", site_id: "site-3", template_id: "t1" },
    ];
    const period = parsePeriod("2026-09");
    expect(filterRows(rows, { period, dateField: "created_at", siteIds: ["site-1"] }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterRows(rows, { templateIds: ["t1"] }).map((r) => r.id)).toEqual([1, 2, 4]);
  });

  it("file names cannot escape the export folder", () => {
    expect(safeStem("../../etc/passwd")).toBe("etc-passwd");
    expect(safeStem("my report.csv")).toBe("my-report");
  });
});
