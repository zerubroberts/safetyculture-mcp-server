import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { maskText } from "../security/redact.js";
import { applyPii, type ExportPolicy } from "./pii.js";

/**
 * RFC 4180 CSV with three extra protections:
 * - privacy: every row goes through the export policy (applyPii) inside the writer, and header
 *   cells / JSONL keys are masked too, so no exporter and no new column can bypass it
 * - spreadsheet formula injection: text cells starting with = + - @ TAB or CR get a leading
 *   apostrophe, so Excel / Sheets / LibreOffice show them as text instead of evaluating them
 * - nested values (objects, arrays) become JSON strings, one column per top-level field
 * Files are UTF-8 with a BOM (Excel needs it to read non-ASCII text) and CRLF line endings.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralise(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Turns one value into its cell text (before quoting). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return neutralise(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  return neutralise(JSON.stringify(value));
}

export function quote(text: string): string {
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvLine = (values: unknown[]) => values.map((v) => quote(cellText(v))).join(",");

/** Column order: first appearance across rows (so sparse fields are still included). */
export function columnsOf(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

/** Header cells are data too (dataset columns come from cached keys): mask them like free text. */
const headerCells = (columns: string[], policy: ExportPolicy) => columns.map((c) => maskText(c, policy.pii, policy.key));

const rowCells = (row: Record<string, unknown>, columns: string[], policy: ExportPolicy) => {
  const clean = applyPii(row, policy.pii, policy.key);
  return columns.map((c) => clean[c]);
};

export function toCsv(rows: Record<string, unknown>[], policy: ExportPolicy, columns = columnsOf(rows)): string {
  const lines = [csvLine(headerCells(columns, policy))];
  for (const r of rows) lines.push(csvLine(rowCells(r, columns, policy)));
  return `${lines.join("\r\n")}\r\n`;
}

const BOM = "﻿";

/**
 * Writes rows to a CSV file in chunks (large feeds never sit in memory as one string), applying the
 * export policy to every row. Pass original cached rows, not already-masked ones. Returns rows written.
 */
export function writeCsv(path: string, rows: Record<string, unknown>[], policy: ExportPolicy, columns = columnsOf(rows)): number {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w", 0o600);
  try {
    writeSync(fd, BOM + csvLine(headerCells(columns, policy)) + "\r\n");
    let chunk: string[] = [];
    for (const r of rows) {
      chunk.push(csvLine(rowCells(r, columns, policy)));
      if (chunk.length >= 1000) {
        writeSync(fd, chunk.join("\r\n") + "\r\n");
        chunk = [];
      }
    }
    if (chunk.length) writeSync(fd, chunk.join("\r\n") + "\r\n");
  } finally {
    closeSync(fd);
  }
  return rows.length;
}

/** Writes JSON Lines, applying the export policy to every row (top-level keys masked too). */
export function writeJsonl(path: string, rows: Record<string, unknown>[], policy: ExportPolicy): number {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w", 0o600);
  try {
    let chunk: string[] = [];
    for (const r of rows) {
      const clean = applyPii(r, policy.pii, policy.key);
      chunk.push(JSON.stringify(Object.fromEntries(Object.entries(clean).map(([k, v]) => [maskText(k, policy.pii, policy.key), v]))));
      if (chunk.length >= 1000) {
        writeSync(fd, chunk.join("\n") + "\n");
        chunk = [];
      }
    }
    if (chunk.length) writeSync(fd, chunk.join("\n") + "\n");
  } finally {
    closeSync(fd);
  }
  return rows.length;
}

/** Minimal RFC 4180 parser (used by tests and to verify bundles). Strips a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && src[i + 1] === "\n") {
      // handled by the \n branch
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
