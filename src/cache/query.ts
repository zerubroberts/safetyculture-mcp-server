import { spawn } from "node:child_process";
import { ToolError } from "../core/errors.js";

export const QUERY_ROW_CAP = 500;
export const QUERY_TIMEOUT_MS = 10_000;
export const QUERY_MAX_BYTES = 8_000_000;

// Statements and functions that write, change connection state or reach outside the cache file.
// REPLACE is only rejected as a statement (replace() the string function is fine).
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\battach\b/i, "ATTACH"],
  [/\bdetach\b/i, "DETACH"],
  [/\bpragma/i, "PRAGMA (including pragma_ table functions)"],
  [/\binsert\b/i, "INSERT"],
  [/\bupdate\b/i, "UPDATE"],
  [/\bdelete\b/i, "DELETE"],
  [/\breplace\b(?!\s*\()/i, "REPLACE"],
  [/\bupsert\b/i, "UPSERT"],
  [/\bcreate\b/i, "CREATE"],
  [/\bdrop\b/i, "DROP"],
  [/\balter\b/i, "ALTER"],
  [/\bvacuum\b/i, "VACUUM"],
  [/\breindex\b/i, "REINDEX"],
  [/\banalyze\b/i, "ANALYZE"],
  [/\bbegin\b/i, "BEGIN"],
  [/\bcommit\b/i, "COMMIT"],
  [/\brollback\b/i, "ROLLBACK"],
  [/\bsavepoint\b/i, "SAVEPOINT"],
  [/\brelease\b/i, "RELEASE"],
  [/\bload_extension\b/i, "load_extension()"],
];

/**
 * Removes comments and the contents of string literals and quoted identifiers, so keyword and
 * semicolon checks only see SQL structure (a value like 'drop; table' is harmless data).
 */
export function sqlStructure(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      out += " ";
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new ToolError("Unterminated /* comment in the query.");
      i = end + 2;
      out += " ";
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new ToolError("Unterminated quote in the query.");
        if (sql[j] === close) {
          if (close !== "]" && sql[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += c === "'" ? "''" : "x";
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Accepts exactly one SELECT / WITH statement; throws a ToolError explaining any rejection. */
export function guardQuery(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, "").trim();
  if (!trimmed) throw new ToolError("Provide a SELECT query.");
  if (trimmed.length > 20_000) throw new ToolError("Query is too long (max 20,000 characters).");
  const structure = sqlStructure(trimmed);
  if (structure.includes(";")) throw new ToolError("Only one statement is allowed: remove the extra ';'.");
  if (!/^\s*(select|with)\b/i.test(structure)) throw new ToolError("Only read-only SELECT (or WITH ... SELECT) queries are allowed.");
  for (const [re, name] of FORBIDDEN)
    if (re.test(structure)) throw new ToolError(`${name} is not allowed in sc_query_cache: the cache is queried read-only, one SELECT at a time.`);
  return trimmed;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  duration_ms: number;
}

// Runs in a short-lived child process so a runaway query can be killed at the time cap (node:sqlite
// has no interrupt, and a worker thread cannot be stopped mid-statement). The connection is
// read-only and the query is wrapped so at most rowCap + 1 rows are read. Input arrives on stdin,
// the result leaves as one JSON line on stdout.
const CHILD_SOURCE = `
const original = process.emitWarning;
process.emitWarning = function (w, t, ...rest) {
  const type = typeof t === "string" ? t : t && t.type;
  if ((type === "ExperimentalWarning" || (w && w.name === "ExperimentalWarning")) && /sqlite/i.test(String((w && w.message) || w))) return;
  return original.call(process, w, t, ...rest);
};
const { DatabaseSync } = require("node:sqlite");
process.emitWarning = original;
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let db;
  let out;
  try {
    const job = JSON.parse(input);
    db = new DatabaseSync(job.path, { readOnly: true, timeout: 2000 });
    const stmt = db.prepare("SELECT * FROM (" + job.sql + "\\n) LIMIT " + (job.rowCap + 1));
    const rows = stmt.all().map((r) => Object.assign({}, r));
    // StatementSync.columns() only exists on newer Node versions.
    const columns = typeof stmt.columns === "function" ? stmt.columns().map((c) => c.name) : rows[0] ? Object.keys(rows[0]) : [];
    out = { ok: true, columns, rows };
  } catch (err) {
    out = { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (db) db.close();
  }
  process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
});
`;

// The child needs no credentials: drop anything secret-looking from its environment.
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/token|secret|key|password|webhook/i.test(k)));

export function runReadOnlyQuery(
  path: string,
  sql: string,
  opts: { rowCap?: number; timeoutMs?: number } = {},
): Promise<QueryResult> {
  const safe = guardQuery(sql);
  const rowCap = Math.min(QUERY_ROW_CAP, Math.max(1, opts.rowCap ?? QUERY_ROW_CAP));
  const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CHILD_SOURCE], { stdio: ["pipe", "pipe", "pipe"], env: childEnv(), windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new ToolError(`Query stopped after ${Math.round(timeoutMs / 100) / 10} s. Add filters or a LIMIT, or aggregate in SQL.`))),
      timeoutMs,
    );
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      stdout += c;
      // Rows are capped by count in the child; this caps total bytes so one huge row cannot
      // exhaust the server's memory.
      if (stdout.length > QUERY_MAX_BYTES)
        finish(() => reject(new ToolError(`Query result is larger than ${QUERY_MAX_BYTES / 1_000_000} MB. Select fewer or shorter columns, or aggregate in SQL.`)));
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c.slice(0, 2000)));
    child.on("error", (err) => finish(() => reject(new ToolError(`Could not start the query process: ${err.message}`))));
    child.on("close", () =>
      finish(() => {
        let msg: { ok: boolean; error?: string; columns?: string[]; rows?: Record<string, unknown>[] };
        try {
          msg = JSON.parse(stdout);
        } catch {
          return reject(new ToolError(`Query process failed${stderr ? `: ${stderr.trim().split("\n").at(-1)}` : "."}`));
        }
        if (!msg.ok) return reject(new ToolError(`SQLite rejected the query: ${msg.error}`));
        const rows = msg.rows ?? [];
        resolve({ columns: msg.columns ?? [], rows: rows.slice(0, rowCap), truncated: rows.length > rowCap, duration_ms: Date.now() - started });
      }),
    );
    child.stdin.end(JSON.stringify({ path, sql: safe, rowCap }));
  });
}
