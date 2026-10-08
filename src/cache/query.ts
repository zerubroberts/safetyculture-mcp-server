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

// Checked against the raw text as well (lower-cased, comments removed, quotes KEPT): SQLite lets a
// quoted identifier name a table-valued function, so "pragma_database_list", [pragma_table_list]
// and `pragma_...` all run. These names have no business in a cache query, even inside a string
// literal, so a false positive on a literal is an accepted cost.
const FORBIDDEN_RAW: Array<[RegExp, string]> = [
  [/\bpragma/, "PRAGMA (including pragma_ table functions, quoted or not)"],
  [/\battach\b/, "ATTACH"],
  [/\bload_extension\b/, "load_extension()"],
  [/\breadfile\b/, "readfile()"],
  [/\bwritefile\b/, "writefile()"],
  [/\bfsdir\b/, "fsdir()"],
  [/\bzipfile\b/, "zipfile()"],
  [/\bfts3_tokenizer\b/, "fts3_tokenizer()"],
];

/**
 * Removes comments and the contents of string literals and quoted identifiers, so keyword and
 * semicolon checks only see SQL structure (a value like 'drop; table' is harmless data).
 */
export function sqlStructure(sql: string): string {
  return scanSql(sql, false);
}

/** Removes comments only: string literals and quoted identifiers are kept verbatim. */
export function sqlWithoutComments(sql: string): string {
  return scanSql(sql, true);
}

// One tokenizer for both views, so they can never disagree about where a comment or quote is.
function scanSql(sql: string, keepQuoted: boolean): string {
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
      out += keepQuoted ? sql.slice(i, j + 1) : c === "'" ? "''" : "x";
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
  const raw = sqlWithoutComments(trimmed).toLowerCase();
  for (const [re, name] of FORBIDDEN)
    if (re.test(structure)) throw new ToolError(`${name} is not allowed in sc_query_cache: the cache is queried read-only, one SELECT at a time.`);
  for (const [re, name] of FORBIDDEN_RAW)
    if (re.test(raw)) throw new ToolError(`${name} is not allowed in sc_query_cache (also rejected inside quotes and string literals).`);
  return trimmed;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  /** Why rows were cut: the row cap, or the result-size budget (QUERY_MAX_BYTES). */
  truncated_reason?: "rows" | "bytes";
  duration_ms: number;
}

/** V8 heap cap of the query child: a hostile query exhausts the child, never the server. */
export const QUERY_CHILD_HEAP_MB = 256;
// Room for the JSON envelope around the rows (ok flag, columns, brackets).
const ENVELOPE_RESERVE = 64 * 1024;

// Runs in a short-lived child process so a runaway query can be killed at the time cap (node:sqlite
// has no interrupt, and a worker thread cannot be stopped mid-statement). The connection is
// read-only and the query is wrapped so at most rowCap + 1 rows are read. Rows are streamed with
// iterate() against a running byte budget, so the child never holds more than ~maxBytes of
// serialised rows; its heap is capped too (--max-old-space-size). Input arrives on stdin, the
// result leaves as one JSON line on stdout.
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
    const replacer = (k, v) => (typeof v === "bigint" ? v.toString() : v);
    // StatementSync.columns() only exists on newer Node versions.
    let columns = typeof stmt.columns === "function" ? stmt.columns().map((c) => c.name) : null;
    let budget = job.maxBytes - (columns ? JSON.stringify(columns).length : 0);
    // Cheap lower bound of a row's JSON size, checked BEFORE serialising it, so one enormous value
    // is rejected without building an even larger JSON string from it.
    const minSize = (r) => {
      let n = 2;
      for (const k in r) {
        const v = r[k];
        n += k.length + 4;
        if (typeof v === "string") n += v.length;
        else if (v instanceof Uint8Array) n += v.byteLength * 6;
        else n += 4;
      }
      return n;
    };
    const parts = [];
    let reason = null;
    let tooLarge = false;
    for (const r of stmt.iterate()) {
      if (parts.length >= job.rowCap) {
        reason = "rows";
        break;
      }
      const fits = minSize(r) <= budget;
      const text = fits ? JSON.stringify(Object.assign({}, r), replacer) : "";
      if (!fits || text.length + 1 > budget) {
        reason = "bytes";
        tooLarge = parts.length === 0;
        break;
      }
      budget -= text.length + 1;
      parts.push(text);
      if (!columns) columns = Object.keys(r);
    }
    out = tooLarge
      ? JSON.stringify({ ok: false, code: "row_too_large" })
      : '{"ok":true,"truncated_reason":' + JSON.stringify(reason) + ',"columns":' + JSON.stringify(columns || []) + ',"rows":[' + parts.join(",") + "]}";
  } catch (err) {
    out = JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) });
  } finally {
    if (db) db.close();
  }
  process.stdout.write(out);
});
`;

// The child needs no credentials: drop anything secret-looking from its environment. NODE_OPTIONS
// is dropped too so it cannot lift the heap cap, preload modules or open an inspector port.
const childEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/token|secret|key|password|webhook/i.test(k) && !/^node_options$/i.test(k)));

// How the child dies when a value cannot fit its memory: V8 heap exhaustion, or (for values past
// V8's maximum string length) a fatal CHECK inside node:sqlite.
const OOM = /heap out of memory|reached heap limit|allocation failed|fatal error|check failed/i;

export function runReadOnlyQuery(
  path: string,
  sql: string,
  opts: { rowCap?: number; timeoutMs?: number } = {},
): Promise<QueryResult> {
  let safe: string;
  try {
    safe = guardQuery(sql);
  } catch (err) {
    return Promise.reject(err);
  }
  const rowCap = Math.min(QUERY_ROW_CAP, Math.max(1, opts.rowCap ?? QUERY_ROW_CAP));
  const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${QUERY_CHILD_HEAP_MB}`, "-e", CHILD_SOURCE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv(),
      windowsHide: true,
    });
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
      // The child stops at its byte budget; this second cap protects the server if it ever does not.
      if (stdout.length > QUERY_MAX_BYTES)
        finish(() => reject(new ToolError(`Query result is larger than ${QUERY_MAX_BYTES / 1_000_000} MB. Select fewer or shorter columns, or aggregate in SQL.`)));
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      if (stderr.length < 8_000) stderr += c.slice(0, 2000);
    });
    child.on("error", (err) => finish(() => reject(new ToolError(`Could not start the query process: ${err.message}`))));
    child.on("close", () =>
      finish(() => {
        let msg: { ok: boolean; error?: string; code?: string; columns?: string[]; rows?: Record<string, unknown>[]; truncated_reason?: "rows" | "bytes" | null };
        try {
          msg = JSON.parse(stdout);
        } catch {
          if (OOM.test(stderr))
            return reject(
              new ToolError(`Query stopped: a value did not fit the query process's ${QUERY_CHILD_HEAP_MB} MB memory limit. Select fewer or shorter values (substr()), or aggregate in SQL.`),
            );
          return reject(new ToolError(`Query process failed${stderr ? `: ${stderr.trim().split("\n").at(-1)}` : "."}`));
        }
        if (msg.code === "row_too_large")
          return reject(new ToolError(`A single result row is larger than the ${QUERY_MAX_BYTES / 1_000_000} MB result limit. Select fewer or shorter columns (substr()), or aggregate in SQL.`));
        if (!msg.ok) return reject(new ToolError(`SQLite rejected the query: ${msg.error}`));
        const rows = msg.rows ?? [];
        const reason = msg.truncated_reason ?? (rows.length > rowCap ? "rows" : undefined);
        resolve({
          columns: msg.columns ?? [],
          rows: rows.slice(0, rowCap),
          truncated: reason !== undefined,
          ...(reason ? { truncated_reason: reason } : {}),
          duration_ms: Date.now() - started,
        });
      }),
    );
    child.stdin.end(JSON.stringify({ path, sql: safe, rowCap, maxBytes: QUERY_MAX_BYTES - ENVELOPE_RESERVE }));
  });
}
