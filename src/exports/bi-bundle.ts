import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CacheReader, FeedName } from "../cache/contract.js";
import type { PiiLevel } from "../core/config.js";
import { inPeriod, type Period } from "../core/time.js";
import { VERSION } from "../version.js";
import { writeCsv } from "./csv.js";

/**
 * Star-schema export of the local cache for Power BI, Qlik Sense and Excel.
 *
 * Every column name is unique across the bundle except the intended keys (site_id, template_id,
 * date_key, inspection_id, user_id via aliases), so Qlik's associative model links tables only on
 * keys and Power BI's relationship autodetect does not guess wrong. Flags are 0/1 integers (so Sum
 * counts them), timestamps are UTC "YYYY-MM-DD HH:MM:SS", date_key is YYYYMMDD.
 */

type ColType = "text" | "int" | "number" | "flag" | "datetime" | "date";
interface Column {
  name: string;
  type: ColType;
}
interface Relationship {
  from: string;
  to: string;
  cardinality: "many-to-one";
  /** Power BI allows one active path between two tables; the others are kept inactive. */
  active: boolean;
  note?: string;
}
interface TableSpec {
  name: string;
  kind: "fact" | "dim";
  grain: string;
  primary_key: string;
  columns: Column[];
  /** Qlik: alias this FK column to the dimension key name (user_id). */
  qlikAlias?: Record<string, string>;
  /** Qlik: fact_type label used when facts are concatenated. */
  qlikFactType?: string;
}

const c = (name: string, type: ColType = "text"): Column => ({ name, type });

export const TABLES: TableSpec[] = [
  {
    name: "fact_inspections",
    kind: "fact",
    grain: "One row per inspection (archived and incomplete included).",
    primary_key: "inspection_id",
    qlikFactType: "inspection",
    qlikAlias: { inspector_user_id: "user_id" },
    columns: [
      c("inspection_id"),
      c("template_id"),
      c("site_id"),
      c("inspector_user_id"),
      c("date_key", "int"),
      c("inspection_name"),
      c("conducted_at", "datetime"),
      c("started_at", "datetime"),
      c("completed_at", "datetime"),
      c("modified_at", "datetime"),
      c("inspection_is_completed", "flag"),
      c("inspection_is_archived", "flag"),
      c("inspection_score", "number"),
      c("inspection_max_score", "number"),
      c("inspection_score_pct", "number"),
      c("inspection_duration", "int"),
      c("document_no"),
    ],
  },
  {
    name: "fact_inspection_items",
    kind: "fact",
    grain: "One row per item (question, section, field) of each inspection.",
    primary_key: "inspection_item_id",
    columns: [
      c("inspection_item_id"),
      c("inspection_id"),
      c("item_id"),
      c("parent_item_id"),
      c("item_index", "int"),
      c("item_section"),
      c("item_label"),
      c("item_type"),
      c("item_response"),
      c("item_is_failed", "flag"),
      c("item_score", "number"),
      c("item_max_score", "number"),
      c("item_score_pct", "number"),
      c("item_is_mandatory", "flag"),
      c("item_is_inactive", "flag"),
    ],
  },
  {
    name: "fact_actions",
    kind: "fact",
    grain: "One row per action.",
    primary_key: "action_id",
    qlikFactType: "action",
    qlikAlias: { creator_user_id: "user_id" },
    columns: [
      c("action_id"),
      c("action_ref"),
      c("action_title"),
      c("action_status"),
      c("action_priority"),
      c("action_type"),
      c("action_labels"),
      c("site_id"),
      c("template_id"),
      c("inspection_id"),
      c("creator_user_id"),
      c("date_key", "int"),
      c("created_at", "datetime"),
      c("due_at", "datetime"),
      c("completed_at", "datetime"),
      c("modified_at", "datetime"),
      c("action_is_open", "flag"),
      c("action_is_overdue", "flag"),
    ],
  },
  {
    name: "fact_issues",
    kind: "fact",
    grain: "One row per issue.",
    primary_key: "issue_id",
    qlikFactType: "issue",
    qlikAlias: { creator_user_id: "user_id" },
    columns: [
      c("issue_id"),
      c("issue_ref"),
      c("issue_title"),
      c("issue_status"),
      c("issue_priority"),
      c("issue_category_id"),
      c("issue_category"),
      c("site_id"),
      c("template_id"),
      c("inspection_id"),
      c("creator_user_id"),
      c("date_key", "int"),
      c("occurred_at", "datetime"),
      c("created_at", "datetime"),
      c("due_at", "datetime"),
      c("completed_at", "datetime"),
      c("modified_at", "datetime"),
      c("issue_is_open", "flag"),
    ],
  },
  {
    name: "fact_schedule_occurrences",
    kind: "fact",
    grain: "One row per scheduled occurrence per assignee (as the scheduling feed returns it).",
    primary_key: "occurrence_row_id",
    qlikFactType: "schedule_occurrence",
    columns: [
      c("occurrence_row_id"),
      c("schedule_id"),
      c("occurrence_id"),
      c("template_id"),
      c("site_id"),
      c("inspection_id"),
      c("assignee_id"),
      c("date_key", "int"),
      c("start_at", "datetime"),
      c("due_at", "datetime"),
      c("miss_at", "datetime"),
      c("completed_at", "datetime"),
      c("occurrence_status"),
      c("completion_rule"),
    ],
  },
  {
    name: "dim_sites",
    kind: "dim",
    grain: "One row per site or site-hierarchy level (deleted sites included).",
    primary_key: "site_id",
    columns: [c("site_id"), c("site_name"), c("site_type"), c("parent_site_id"), c("parent_site_name"), c("site_is_deleted", "flag")],
  },
  {
    name: "dim_templates",
    kind: "dim",
    grain: "One row per template (archived included).",
    primary_key: "template_id",
    columns: [c("template_id"), c("template_name"), c("template_is_archived", "flag"), c("template_created_at", "datetime"), c("template_modified_at", "datetime")],
  },
  {
    name: "dim_users",
    kind: "dim",
    grain: "One row per user. Names and emails follow the server's privacy level (SC_PII).",
    primary_key: "user_id",
    columns: [
      c("user_id"),
      c("user_name"),
      c("user_email"),
      c("user_is_active", "flag"),
      c("user_seat_type"),
      c("user_last_seen_at", "datetime"),
      c("user_created_at", "datetime"),
    ],
  },
  {
    name: "dim_date",
    kind: "dim",
    grain: "One row per calendar day (UTC) from the earliest to the latest fact date.",
    primary_key: "date_key",
    columns: [
      c("date_key", "int"),
      c("date", "date"),
      c("year", "int"),
      c("quarter"),
      c("month", "int"),
      c("month_name"),
      c("year_month"),
      c("iso_year", "int"),
      c("iso_week", "int"),
      c("day_of_week", "int"),
      c("day_name"),
      c("is_weekend", "flag"),
    ],
  },
];

const rel = (from: string, to: string, active = true, note?: string): Relationship => ({ from, to, cardinality: "many-to-one", active, ...(note ? { note } : {}) });
const INACTIVE_NOTE = "Inactive in Power BI to avoid an ambiguous path via dim_sites; use USERELATIONSHIP in measures that need it.";

export const RELATIONSHIPS: Relationship[] = [
  rel("fact_inspections.site_id", "dim_sites.site_id"),
  rel("fact_inspections.template_id", "dim_templates.template_id"),
  rel("fact_inspections.inspector_user_id", "dim_users.user_id"),
  rel("fact_inspections.date_key", "dim_date.date_key"),
  rel("fact_inspection_items.inspection_id", "fact_inspections.inspection_id"),
  rel("fact_actions.site_id", "dim_sites.site_id"),
  rel("fact_actions.template_id", "dim_templates.template_id"),
  rel("fact_actions.creator_user_id", "dim_users.user_id"),
  rel("fact_actions.date_key", "dim_date.date_key"),
  rel("fact_actions.inspection_id", "fact_inspections.inspection_id", false, INACTIVE_NOTE),
  rel("fact_issues.site_id", "dim_sites.site_id"),
  rel("fact_issues.template_id", "dim_templates.template_id"),
  rel("fact_issues.creator_user_id", "dim_users.user_id"),
  rel("fact_issues.date_key", "dim_date.date_key"),
  rel("fact_issues.inspection_id", "fact_inspections.inspection_id", false, INACTIVE_NOTE),
  rel("fact_schedule_occurrences.site_id", "dim_sites.site_id"),
  rel("fact_schedule_occurrences.template_id", "dim_templates.template_id"),
  rel("fact_schedule_occurrences.date_key", "dim_date.date_key"),
  rel("fact_schedule_occurrences.inspection_id", "fact_inspections.inspection_id", false, INACTIVE_NOTE),
];

export const BUNDLE_FEEDS: FeedName[] = ["inspections", "inspection_items", "actions", "issues", "schedules", "schedule_occurrences", "sites", "templates", "users"];

type Row = Record<string, unknown>;
const str = (v: unknown): string | undefined => (v === undefined || v === null || v === "" ? undefined : String(v));
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function parseTime(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : undefined;
}
export const formatDateTime = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateKeyOf = (d: Date) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

/** Coerces a raw value to the column type's cell value ("" for missing / unparseable). */
function coerce(value: unknown, type: ColType): string | number | object {
  if (value === undefined || value === null || value === "") return "";
  switch (type) {
    case "int":
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return "";
      return type === "int" ? Math.round(n) : n;
    }
    case "flag":
      return value === true || value === 1 || value === "true" || value === "1" ? 1 : 0;
    case "datetime": {
      const d = value instanceof Date ? value : parseTime(value);
      return d ? formatDateTime(d) : "";
    }
    case "date": {
      const d = value instanceof Date ? value : parseTime(value);
      return d ? formatDate(d) : "";
    }
    default:
      // Nested values stay structured so the writer's privacy policy walks them before they become
      // JSON text (masking JSON text directly can miss a phone number right after an escape like \n).
      return typeof value === "object" ? value : String(value);
  }
}

function shape(spec: TableSpec, rows: Row[]): Row[] {
  return rows.map((r) => Object.fromEntries(spec.columns.map((col) => [col.name, coerce(r[col.name], col.type)])));
}

const CLOSED_STATUS = /complete|done|closed|resolved|can.?t\s*do|cannot|won.?t\s*do/i;

export interface BundleResult {
  dir: string;
  files: string[];
  manifest: Manifest;
}

export interface Manifest {
  generator: string;
  as_of: string;
  period: { from: string; to: string; label: string } | null;
  pii: PiiLevel;
  conventions: Record<string, string>;
  tables: Array<{ name: string; file: string; kind: string; grain: string; primary_key: string; rows: number; columns: Column[] }>;
  relationships: Relationship[];
  coverage: Array<{ feed: FeedName; rows: number; last_synced_at: string | null; complete: boolean }>;
}

/**
 * Builds the bundle rows from cached feeds (pure: no file I/O). Rows are NOT privacy-masked: they
 * must only leave the process through writeCsv / writeJsonl, which apply the policy to every cell.
 */
export function buildBundleTables(cache: CacheReader, opts: { pii: PiiLevel; now: Date; period?: Period }): Record<string, Row[]> {
  const inPer = (d: Date | undefined) => !opts.period || (d !== undefined && inPeriod(d.toISOString(), opts.period));

  const inspectionsRaw = cache.rows("inspections");
  const inspectionSite = new Map<string, string | undefined>();
  const fInspections: Row[] = [];
  const keptInspections = new Set<string>();
  for (const r of inspectionsRaw) {
    const id = str(r.id);
    if (!id) continue;
    inspectionSite.set(id, str(r.site_id));
    const when = parseTime(r.conducted_on) ?? parseTime(r.date_started) ?? parseTime(r.created_at);
    if (!inPer(when)) continue;
    keptInspections.add(id);
    fInspections.push({
      inspection_id: id,
      template_id: str(r.template_id),
      site_id: str(r.site_id),
      inspector_user_id: str(r.owner_id),
      date_key: when ? dateKeyOf(when) : undefined,
      inspection_name: str(r.name),
      conducted_at: r.conducted_on,
      started_at: r.date_started,
      completed_at: r.date_completed,
      modified_at: r.modified_at,
      inspection_is_completed: Boolean(str(r.date_completed)),
      inspection_is_archived: r.archived === true,
      inspection_score: r.score,
      inspection_max_score: r.max_score,
      inspection_score_pct: r.score_percentage,
      inspection_duration: r.duration,
      document_no: r.document_no,
    });
  }

  const fItems: Row[] = [];
  for (const r of cache.rows("inspection_items")) {
    const id = str(r.id);
    const audit = str(r.audit_id);
    if (!id || !audit || !keptInspections.has(audit)) continue;
    fItems.push({
      inspection_item_id: id,
      inspection_id: audit,
      item_id: r.item_id,
      parent_item_id: r.parent_id,
      item_index: r.item_index,
      item_section: r.category,
      item_label: r.label,
      item_type: r.type,
      item_response: r.response,
      item_is_failed: r.is_failed_response === true,
      item_score: r.score,
      item_max_score: r.max_score,
      item_score_pct: r.score_percentage,
      item_is_mandatory: r.mandatory === true,
      item_is_inactive: r.inactive === true,
    });
  }

  const fActions: Row[] = [];
  for (const r of cache.rows("actions")) {
    const id = str(r.id);
    if (!id) continue;
    const created = parseTime(r.created_at);
    if (!inPer(created)) continue;
    const due = parseTime(r.due_date);
    const open = !str(r.completed_at) && !CLOSED_STATUS.test(String(r.status ?? ""));
    fActions.push({
      action_id: id,
      action_ref: r.unique_id,
      action_title: r.title,
      action_status: r.status,
      action_priority: r.priority,
      action_type: r.type_name,
      action_labels: r.action_label,
      site_id: str(r.site_id),
      template_id: str(r.template_id),
      inspection_id: str(r.audit_id),
      creator_user_id: str(r.creator_user_id),
      date_key: created ? dateKeyOf(created) : undefined,
      created_at: r.created_at,
      due_at: r.due_date,
      completed_at: r.completed_at,
      modified_at: r.modified_at,
      action_is_open: open,
      action_is_overdue: open && due !== undefined && due.getTime() < opts.now.getTime(),
    });
  }

  const fIssues: Row[] = [];
  for (const r of cache.rows("issues")) {
    const id = str(r.id);
    if (!id) continue;
    const when = parseTime(r.occurred_at) ?? parseTime(r.created_at);
    if (!inPer(when)) continue;
    fIssues.push({
      issue_id: id,
      issue_ref: r.unique_id,
      issue_title: r.title,
      issue_status: r.status,
      issue_priority: r.priority,
      issue_category_id: r.category_id,
      issue_category: r.category_label,
      site_id: str(r.site_id),
      template_id: str(r.template_id),
      inspection_id: str(r.inspection_id),
      creator_user_id: str(r.creator_id),
      date_key: when ? dateKeyOf(when) : undefined,
      occurred_at: r.occurred_at,
      created_at: r.created_at,
      due_at: r.due_at,
      completed_at: r.completed_at,
      modified_at: r.modified_at,
      issue_is_open: !str(r.completed_at),
    });
  }

  const scheduleSites = new Map<string, unknown[]>();
  for (const s of cache.rows("schedules")) if (str(s.id)) scheduleSites.set(String(s.id), Array.isArray(s.site_ids) ? s.site_ids : []);
  const fOccurrences: Row[] = [];
  for (const r of cache.rows("schedule_occurrences")) {
    const id = str(r.id);
    if (!id) continue;
    const due = parseTime(r.due_time);
    if (!inPer(due)) continue;
    const audit = str(r.audit_id);
    const sites = scheduleSites.get(String(r.schedule_id ?? "")) ?? [];
    // Site: from the inspection the occurrence produced, else the schedule's only site.
    const site = (audit ? inspectionSite.get(audit) : undefined) ?? (sites.length === 1 ? str(sites[0]) : undefined);
    fOccurrences.push({
      occurrence_row_id: id,
      schedule_id: r.schedule_id,
      occurrence_id: r.occurrence_id,
      template_id: str(r.template_id),
      site_id: site,
      inspection_id: audit,
      assignee_id: r.assignee_id,
      date_key: due ? dateKeyOf(due) : undefined,
      start_at: r.start_time,
      due_at: r.due_time,
      miss_at: r.miss_time,
      completed_at: r.completed_at,
      occurrence_status: r.occurrence_status,
      completion_rule: r.completion_rule,
    });
  }

  const sitesRaw = cache.rows("sites");
  const siteNames = new Map(sitesRaw.map((s) => [String(s.id), str(s.name)]));
  const dSites = sitesRaw
    .filter((s) => str(s.id))
    .map((s) => ({
      site_id: String(s.id),
      site_name: s.name,
      site_type: s.meta_label,
      parent_site_id: str(s.parent_id),
      parent_site_name: str(s.parent_id) ? siteNames.get(String(s.parent_id)) : undefined,
      site_is_deleted: s.deleted === true,
    }));

  const dTemplates = cache
    .rows("templates")
    .filter((t) => str(t.id))
    .map((t) => ({
      template_id: String(t.id),
      template_name: t.name,
      template_is_archived: t.archived === true,
      template_created_at: t.created_at,
      template_modified_at: t.modified_at,
    }));

  const dUsers = cache
    .rows("users")
    .filter((u) => str(u.id))
    .map((u) => ({
      user_id: String(u.id),
      // Raw here: the CSV writer applies the privacy policy to every cell of the bundle (user_email
      // pseudonymised at contact and strict, user_name at strict).
      user_name: [str(u.firstname), str(u.lastname)].filter(Boolean).join(" ") || undefined,
      user_email: str(u.email),
      user_is_active: u.active === true,
      user_seat_type: u.seat_type,
      user_last_seen_at: u.last_seen_at,
      user_created_at: u.created_at,
    }));

  const keys = [...fInspections, ...fActions, ...fIssues, ...fOccurrences].map((r) => r.date_key).filter((k): k is number => typeof k === "number");
  const dDate = dateDimension(keys);

  return {
    fact_inspections: fInspections,
    fact_inspection_items: fItems,
    fact_actions: fActions,
    fact_issues: fIssues,
    fact_schedule_occurrences: fOccurrences,
    dim_sites: dSites,
    dim_templates: dTemplates,
    dim_users: dUsers,
    dim_date: dDate,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_DATE_SPAN_DAYS = 366 * 30;

function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // Thursday of this ISO week
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  return { year: t.getUTCFullYear(), week: Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7) };
}

/** Continuous calendar covering every fact date (capped at 30 years, anchored at the latest date). */
export function dateDimension(dateKeys: number[]): Row[] {
  if (!dateKeys.length) return [];
  const toDate = (k: number) => new Date(Date.UTC(Math.floor(k / 10000), (Math.floor(k / 100) % 100) - 1, k % 100));
  let min = dateKeys[0]!;
  let max = dateKeys[0]!;
  for (const k of dateKeys) {
    if (k < min) min = k;
    if (k > max) max = k;
  }
  const end = toDate(max);
  let start = toDate(min);
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_DATE_SPAN_DAYS) start = new Date(end.getTime() - MAX_DATE_SPAN_DAYS * 86_400_000);
  const out: Row[] = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const dow = (d.getUTCDay() + 6) % 7;
    const wk = isoWeek(d);
    out.push({
      date_key: dateKeyOf(d),
      date: d,
      year: d.getUTCFullYear(),
      quarter: `Q${Math.floor(d.getUTCMonth() / 3) + 1}`,
      month: d.getUTCMonth() + 1,
      month_name: MONTHS[d.getUTCMonth()],
      year_month: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`,
      iso_year: wk.year,
      iso_week: wk.week,
      day_of_week: dow + 1,
      day_name: DAYS[dow],
      is_weekend: dow >= 5,
    });
  }
  return out;
}

/** Writes the bundle folder: CSVs, manifest.json, Power Query M, Qlik load script, README. */
export function writeBiBundle(cache: CacheReader, opts: { dir: string; pii: PiiLevel; now: Date; period?: Period; key?: Buffer }): BundleResult {
  mkdirSync(opts.dir, { recursive: true });
  const raw = buildBundleTables(cache, opts);
  const files: string[] = [];
  const tables: Manifest["tables"] = [];
  for (const spec of TABLES) {
    const rows = shape(spec, raw[spec.name] ?? []);
    const file = `${spec.name}.csv`;
    const written = writeCsv(join(opts.dir, file), rows, { pii: opts.pii, key: opts.key }, spec.columns.map((col) => col.name));
    files.push(file);
    tables.push({ name: spec.name, file, kind: spec.kind, grain: spec.grain, primary_key: spec.primary_key, rows: written, columns: spec.columns });
  }

  const manifest: Manifest = {
    generator: `safetyculture-mcp ${VERSION}`,
    as_of: opts.now.toISOString(),
    period: opts.period ? { from: opts.period.from.toISOString(), to: opts.period.to.toISOString(), label: opts.period.label } : null,
    pii: opts.pii,
    conventions: {
      encoding: "UTF-8 with BOM, comma-delimited, RFC 4180 quoting, CRLF line endings",
      timestamps: "UTC, formatted YYYY-MM-DD HH:MM:SS",
      date_key: "Integer YYYYMMDD (UTC calendar day) joining facts to dim_date",
      flags: "Integer 1 = yes, 0 = no",
      text_safety: "Text starting with = + - @ TAB or CR is prefixed with an apostrophe to stop spreadsheet formulas",
      privacy:
        "Every text cell follows the privacy level: token-like text is always redacted; at contact and strict, emails become pseudonyms and phone numbers are masked in every column; at strict, user_name is pseudonymised too",
      empty: "Empty cell = no value in the source",
    },
    tables,
    relationships: RELATIONSHIPS,
    coverage: cache.status(BUNDLE_FEEDS).map(({ feed, rows, last_synced_at, complete }) => ({ feed, rows, last_synced_at, complete })),
  };
  writeFileSync(join(opts.dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(opts.dir, "powerbi.pq"), powerQueryScript());
  writeFileSync(join(opts.dir, "qlik.qvs"), qlikScript());
  writeFileSync(join(opts.dir, "README.md"), readme(manifest));
  files.push("manifest.json", "powerbi.pq", "qlik.qvs", "README.md");
  return { dir: opts.dir, files, manifest };
}

const M_TYPES: Record<ColType, string> = {
  text: "type text",
  int: "Int64.Type",
  number: "type number",
  flag: "Int64.Type",
  datetime: "type datetime",
  date: "type date",
};

const relLine = (r: Relationship) => {
  const [ft, fc] = r.from.split(".");
  const [tt, tc] = r.to.split(".");
  return `${ft}[${fc}] many-to-one ${tt}[${tc}]${r.active ? "" : "  (INACTIVE)"}`;
};

export function powerQueryScript(): string {
  const head = [
    "// safetyculture-mcp BI bundle: Power Query (M) for Power BI Desktop and Excel.",
    "//",
    "// Setup (once):",
    '// 1. Transform data > Manage Parameters > New Parameter: Name = FolderPath, Type = Text,',
    '//    Current Value = the full path of this folder, ending with a backslash (e.g. C:\\Exports\\bi-bundle\\).',
    "// 2. For each section below: New Source > Blank Query > Advanced Editor, paste the section,",
    "//    and rename the query to the section name (fact_inspections, dim_sites, ...). Close & Apply.",
    "// 3. Model view: create these relationships (single direction, from dimension to fact),",
    "//    and mark dim_date as the date table (column date).",
    "//",
    ...RELATIONSHIPS.map((r) => `//    ${relLine(r)}`),
    "//",
    "// Inactive relationships avoid two filter paths from dim_sites; activate them per measure with USERELATIONSHIP.",
    "",
  ];
  const sections = TABLES.map((t) =>
    [
      `// ==== Query: ${t.name} ====`,
      `// Grain: ${t.grain} Key: ${t.primary_key}.`,
      "let",
      `    Source = Csv.Document(File.Contents(FolderPath & "${t.name}.csv"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),`,
      "    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),",
      `    Typed = Table.TransformColumnTypes(Promoted, {${t.columns.map((col) => `{"${col.name}", ${M_TYPES[col.type]}}`).join(", ")}}, "en-US")`,
      "in",
      "    Typed",
      "",
    ].join("\n"),
  );
  return [...head, ...sections].join("\n");
}

function qlikField(col: Column, alias?: string): string {
  const out = alias ?? col.name;
  switch (col.type) {
    case "datetime":
      return `Timestamp(Timestamp#([${col.name}], 'YYYY-MM-DD hh:mm:ss')) AS [${out}]`;
    case "date":
      return `Date(Date#([${col.name}], 'YYYY-MM-DD')) AS [${out}]`;
    default:
      return alias ? `[${col.name}] AS [${out}]` : `[${col.name}]`;
  }
}

const QLIK_FORMAT = "(txt, utf8, embedded labels, delimiter is ',', msq)";

export function qlikScript(): string {
  const lines = [
    "// safetyculture-mcp BI bundle: Qlik Sense load script.",
    "// 1. Create a folder data connection pointing at this folder (or upload the CSVs to a space).",
    "// 2. Set vBundlePath below to that connection, ending with '/'. 3. Paste into the data load editor and Load data.",
    "//",
    "// Model: the four fact tables are concatenated into one Facts table (field fact_type says which),",
    "// so the dimensions link once each and there are no synthetic keys or loops. Inspection items",
    "// link to Facts on inspection_id only. Facts.user_id is the inspector for inspections and the",
    "// creator for actions and issues.",
    "",
    "SET vBundlePath = 'lib://SafetyCultureBundle/';",
    "",
  ];
  let factsStarted = false;
  for (const t of TABLES) {
    const isConcatFact = t.kind === "fact" && t.qlikFactType !== undefined;
    const fields = t.columns.map((col) => qlikField(col, t.qlikAlias?.[col.name]));
    if (isConcatFact) fields.unshift(`'${t.qlikFactType}' AS [fact_type]`);
    if (isConcatFact && factsStarted) lines.push("Concatenate ([Facts])");
    else lines.push(`[${isConcatFact ? "Facts" : t.name}]:`);
    if (isConcatFact) factsStarted = true;
    lines.push("LOAD", fields.map((f) => `    ${f}`).join(",\n"), `FROM [$(vBundlePath)${t.name}.csv]`, `${QLIK_FORMAT};`, "");
  }
  return lines.join("\n");
}

function readme(m: Manifest): string {
  const tableRows = m.tables.map((t) => `| ${t.file} | ${t.grain} | ${t.primary_key} | ${t.rows} |`).join("\n");
  const rels = m.relationships.map((r) => `- ${relLine(r)}${r.note ? ` (${r.note})` : ""}`).join("\n");
  const cov = m.coverage
    .map((c) => `| ${c.feed} | ${c.rows} | ${c.last_synced_at ?? "never"} | ${c.complete ? "yes" : "NO (partial)"} |`)
    .join("\n");
  return `# Mitti (SafetyCulture) BI bundle

Exported by ${m.generator} at ${m.as_of} (UTC).${m.period ? ` Facts filtered to ${m.period.label}.` : " All cached records."}
Privacy level: \`${m.pii}\` (applied to every text cell of every table, see Conventions).

## Tables

| File | Grain | Key | Rows |
|---|---|---|---|
${tableRows}

\`manifest.json\` lists every column with its type, the relationships and the row counts above.

## Relationships (many-to-one)

${rels}

## Conventions

${Object.entries(m.conventions)
  .map(([k, v]) => `- **${k}**: ${v}`)
  .join("\n")}

## Power BI Desktop

1. Open \`powerbi.pq\` in a text editor.
2. Transform data > Manage Parameters > New Parameter: \`FolderPath\` (Text) = the full path of this folder ending with \`\\\`.
3. For each section of \`powerbi.pq\`: New Source > Blank Query > Advanced Editor > paste > rename the query to the section name.
4. Close & Apply. In Model view create the relationships listed above (inactive ones: create, then untick "Make this relationship active").
5. Mark \`dim_date\` as the date table (column \`date\`).

## Qlik Sense

1. Create a folder data connection to this folder (or upload the CSVs to a space and use that connection).
2. Open \`qlik.qvs\`, set \`vBundlePath\` to the connection (for example \`lib://SafetyCultureBundle/\`), paste into the data load editor, Load data.
3. Facts are concatenated into one \`Facts\` table with a \`fact_type\` field; dimensions link on site_id, template_id, user_id and date_key.

## Excel

- Quick look: open any CSV directly (UTF-8 with BOM, so accents display correctly).
- Data model: Data > Get Data > From Other Sources > Blank Query, then paste sections of \`powerbi.pq\` exactly as for Power BI (create the \`FolderPath\` parameter first), Load To > Only Create Connection + Add to the Data Model, and create the relationships in Power Pivot > Diagram View.

## Data coverage at export

| Feed | Cached rows | Last synced | Complete |
|---|---|---|---|
${cov}

Partial feeds mean the sync hit its row cap; run sc_sync with a higher max_rows before relying on totals.
`;
}
