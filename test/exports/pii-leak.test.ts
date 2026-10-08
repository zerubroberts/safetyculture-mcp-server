import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeBiBundle } from "../../src/exports/bi-bundle.js";
import { parseCsv } from "../../src/exports/csv.js";
import { writeDataset } from "../../src/exports/dataset.js";
import { pseudonym } from "../../src/security/redact.js";
import { FakeCache } from "../helpers/fake-cache.js";

// SEC-FIX-2 findings 1 and 2: every text cell of every export file follows the privacy policy.
// Poison values are assembled at runtime so the repository leak guard never sees them as literals.
const EMAIL = ["x", "evil.example"].join("@");
const PHONE = "+61 412 345 678";
const TOKEN = "scapi_" + "Q7".repeat(15); // scapi_ + 30 characters
const POISON = `ring ${EMAIL} or ${PHONE}, key ${TOKEN}`;
const NOW = new Date("2026-10-08T00:00:00Z");

function poisoned(): FakeCache {
  return new FakeCache()
    .seed("sites", [
      { id: "site-1", name: `Depot ${POISON}`, meta_label: `Region ${POISON}`, parent_id: "site-r" },
      { id: "site-r", name: `Parent ${POISON}`, meta_label: "region" },
    ])
    .seed("templates", [{ id: "template_1", name: `Check ${POISON}`, archived: false }])
    .seed("users", [{ id: "user_1", firstname: "Alex", lastname: "Demo", email: EMAIL, seat_type: POISON, active: true }])
    .seed("inspections", [
      { id: "audit_1", name: `Walk ${POISON}`, document_no: POISON, template_id: "template_1", site_id: "site-1", owner_id: "user_1", conducted_on: "2026-09-01T09:00:00Z" },
    ])
    .seed("inspection_items", [
      { id: "audit_1_i1", audit_id: "audit_1", item_id: "i1", category: POISON, label: `Contact ${POISON}`, type: "text", response: `Call\n${PHONE} ${EMAIL} ${TOKEN}` },
    ])
    .seed("actions", [
      {
        id: "act-1",
        unique_id: POISON,
        title: `Fix ${POISON}`,
        status: POISON,
        priority: POISON,
        type_name: POISON,
        // Nested values: a phone right after an escaped newline and an email used as an object key.
        action_label: [{ note: `x\n${PHONE}`, [EMAIL]: TOKEN }, POISON],
        site_id: "site-1",
        creator_user_id: "user_1",
        created_at: "2026-09-01T11:00:00Z",
      },
    ])
    .seed("issues", [{ id: "iss-1", unique_id: POISON, title: `Spill ${POISON}`, status: POISON, priority: POISON, category_label: POISON, creator_id: "user_1", created_at: "2026-09-02T09:00:00Z" }])
    .seed("schedules", [{ id: "sch-1", site_ids: ["site-1"] }])
    .seed("schedule_occurrences", [
      { id: "occ-1", schedule_id: "sch-1", occurrence_id: POISON, assignee_id: POISON, due_time: "2026-09-01T17:00:00Z", occurrence_status: POISON, completion_rule: POISON },
    ]);
}

const filesOf = (dir: string) => readdirSync(dir).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));

function expectNoRaw(dir: string, needles: string[]) {
  const files = filesOf(dir);
  expect(files.length).toBeGreaterThan(0);
  for (const { f, text } of files) for (const n of needles) expect(text.includes(n), `${f} contains ${JSON.stringify(n)}`).toBe(false);
}

describe("BI bundle privacy (every table, every text cell)", () => {
  it.each(["contact", "strict"] as const)("pii=%s: no raw email, phone or token in any file", (pii) => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-leak-"));
    writeBiBundle(poisoned(), { dir, pii, now: NOW });
    expectNoRaw(dir, [EMAIL, PHONE, "412 345 678", TOKEN, "scapi_"]);
    const actions = parseCsv(readFileSync(join(dir, "fact_actions.csv"), "utf8"));
    const title = actions[1]![actions[0]!.indexOf("action_title")]!;
    // Masked in place, not blanked: the rest of the text survives.
    expect(title).toBe(`Fix ring ${pseudonym(EMAIL, "email")} or [phone], key [redacted-secret]`);
    // dim_users is pseudonymised exactly once by the writer (same pseudonyms as tool output).
    const users = parseCsv(readFileSync(join(dir, "dim_users.csv"), "utf8"));
    expect(users[1]!.slice(0, 3)).toEqual(["user_1", pii === "strict" ? pseudonym("Alex Demo", "person") : "Alex Demo", pseudonym(EMAIL, "email")]);
  });

  it("pii=none: emails stay, but tokens are redacted everywhere", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmcp-leak-"));
    writeBiBundle(poisoned(), { dir, pii: "none", now: NOW });
    expectNoRaw(dir, [TOKEN, "scapi_"]);
    const users = parseCsv(readFileSync(join(dir, "dim_users.csv"), "utf8"));
    expect(users[1]!.slice(0, 3)).toEqual(["user_1", "Alex Demo", EMAIL]);
  });
});

describe("dataset export privacy (CSV and JSONL)", () => {
  const rows = () => [
    {
      id: "act-1",
      title: `Fix ${POISON}`,
      notes: `Line\n${PHONE}`,
      assignees: ["Alex Demo"],
      meta: { contact: { [EMAIL]: true, text: `see\n${PHONE} ${TOKEN}` } },
      [`col ${TOKEN}`]: "header poison",
      api_token: TOKEN,
    },
  ];

  it.each(["contact", "strict"] as const)("pii=%s: no raw email, phone or token in CSV or JSONL, nested values included", (pii) => {
    for (const format of ["csv", "jsonl"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "scmcp-leak-"));
      writeDataset({ dir, stem: "actions", format, rows: rows(), pii });
      expectNoRaw(dir, [EMAIL, PHONE, "412 345 678", TOKEN, "scapi_"]);
      if (format === "jsonl") {
        const line = JSON.parse(readFileSync(join(dir, "actions.jsonl"), "utf8").trim());
        expect(line.api_token).toBeUndefined();
        if (pii === "strict") expect(line.assignees).toEqual([pseudonym("Alex Demo", "person")]);
      }
    }
  });

  it("pii=none: tokens are redacted in CSV and JSONL (free text, nested values, keys)", () => {
    for (const format of ["csv", "jsonl"] as const) {
      const dir = mkdtempSync(join(tmpdir(), "scmcp-leak-"));
      writeDataset({ dir, stem: "actions", format, rows: rows(), pii: "none" });
      expectNoRaw(dir, [TOKEN, "scapi_"]);
      expect(readFileSync(join(dir, `actions.${format}`), "utf8")).toContain(EMAIL);
    }
  });
});
