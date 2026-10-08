import { join } from "node:path";
import type { PiiLevel } from "../core/config.js";
import { ToolError } from "../core/errors.js";
import { inPeriod, type Period } from "../core/time.js";
import { columnsOf, writeCsv, writeJsonl } from "./csv.js";
import { isStrippedColumn } from "./pii.js";

export interface DatasetFilter {
  period?: Period;
  dateField?: string;
  siteIds?: string[];
  templateIds?: string[];
}

const matchesAny = (value: unknown, wanted: Set<string>) =>
  Array.isArray(value) ? value.some((v) => wanted.has(String(v))) : value !== undefined && value !== null && wanted.has(String(value));

/** Filters cached rows. Site and template filters read site_id / site_ids and template_id. */
export function filterRows(rows: Record<string, unknown>[], f: DatasetFilter): Record<string, unknown>[] {
  const sites = f.siteIds?.length ? new Set(f.siteIds) : undefined;
  const templates = f.templateIds?.length ? new Set(f.templateIds) : undefined;
  return rows.filter((r) => {
    if (f.period && f.dateField && !inPeriod(r[f.dateField] as string | undefined, f.period)) return false;
    if (sites && !matchesAny(r.site_id ?? r.site_ids, sites)) return false;
    if (templates && !matchesAny(r.template_id, templates)) return false;
    return true;
  });
}

/** A safe file stem: letters, digits, dot, dash and underscore only; never a path. */
export function safeStem(name: string): string {
  const stem = name.replace(/\.(csv|jsonl)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80);
  if (!stem) throw new ToolError("file_name must contain letters or digits.");
  return stem;
}

export const timestampSlug = (d: Date) => d.toISOString().replace(/[:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function writeDataset(args: {
  dir: string;
  stem: string;
  format: "csv" | "jsonl";
  rows: Record<string, unknown>[];
  pii: PiiLevel;
  /** Pseudonym key (HTTP: per request); defaults to the process key. */
  key?: Buffer;
  columns?: string[];
}): { path: string; rows: number; columns: string[] } {
  // The writers apply the privacy policy to every row; rows are passed to them unmasked so the
  // policy runs exactly once (pseudonymising a pseudonym would break joins with tool output).
  let columns = columnsOf(args.rows).filter((c) => !isStrippedColumn(c));
  if (args.columns?.length) {
    const unknown = args.columns.filter((c) => !columns.includes(c));
    if (unknown.length && args.rows.length) throw new ToolError(`Unknown column(s): ${unknown.join(", ")}. Available: ${columns.slice(0, 60).join(", ")}.`);
    columns = args.columns;
  }
  const policy = { pii: args.pii, key: args.key };
  const path = join(args.dir, `${args.stem}.${args.format}`);
  if (args.format === "csv") writeCsv(path, args.rows, policy, columns);
  else writeJsonl(path, args.columns?.length ? args.rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))) : args.rows, policy);
  return { path, rows: args.rows.length, columns };
}
