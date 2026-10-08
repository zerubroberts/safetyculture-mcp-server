import type { PiiLevel } from "../core/config.js";
import { maskText, pseudonym, sanitize } from "../security/redact.js";

// Columns produced by this server's own projections that hold a person's display name.
const PERSON_COL = /^(user|creator|owner|author|inspector|assignee|assignees|created_by|completed_by|person|user_full_name|owner_full_name)$/i;

/**
 * Privacy policy for exported files (same levels as tool output, see SC_PII). The CSV and JSONL
 * writers apply it to every row they write, so no exporter (and no new column) can skip it.
 * - every level: credential-like columns are dropped and token-shaped text is redacted in every
 *   string, nested ones included
 * - contact (default): email columns become stable pseudonyms, phone columns are masked, and
 *   emails / phone numbers typed into any other text are masked too
 * - strict: person-name columns become stable pseudonyms too
 * Column rules are by name only, so dates and IDs in other columns are never pseudonymised.
 */
export interface ExportPolicy {
  pii: PiiLevel;
  /** Pseudonym key (HTTP passes a per-request key); defaults to the process key. */
  key?: Buffer;
}

const STRIP =
  /^(password|api_token|access_token|refresh_token|token|secret|signature_secret|client_secret|authorization|kustomer_hash|intercom_jwt|intercom_hmac|knock_info)$/i;
const EMAIL_COL = /(^|_)e?mail$|email/i;
const PHONE_COL = /(^|_)(phone|mobile|phone_number|mobile_phone)$/i;
const NAME_COL =
  /^(firstname|lastname|first_name|last_name|full_name|display_name|owner_name|author_name|creator_name|creator_user_name|task_creator_name|assignee_name|user_name|inspector_name|prepared_by|personnel|subject_user_first_name|subject_user_last_name|userfirstname|userlastname|useremail)$/i;

// sanitize() returns values nested deeper than this unchanged, so deeper values are flattened to
// masked JSON text first instead of being passed through raw.
const MAX_NESTING = 30;

/** True for columns that are never exported (credentials and session hashes). */
export const isStrippedColumn = (name: string) => STRIP.test(name);

function nestingDepth(value: unknown, limit: number): number {
  let depth = 0;
  let level: unknown[] = [value];
  while (level.length) {
    const next: unknown[] = [];
    for (const v of level) if (v && typeof v === "object") next.push(...(Array.isArray(v) ? v : Object.values(v)));
    if (!next.length) break;
    depth++;
    if (depth > limit) return depth;
    level = next;
  }
  return depth;
}

/** Masks object keys too (a map keyed by email address would otherwise keep the address). */
function maskKeys(value: unknown, pii: PiiLevel, key?: Buffer): unknown {
  if (Array.isArray(value)) return value.map((v) => maskKeys(v, pii, key));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[maskText(k, pii, key)] = maskKeys(v, pii, key);
    return out;
  }
  return value;
}

/** Nested values (objects, arrays): the same walk as tool output, plus masked keys. */
function scrubNested(column: string, value: object, pii: PiiLevel, key?: Buffer): unknown {
  if (nestingDepth(value, MAX_NESTING) > MAX_NESTING) return maskText(JSON.stringify(value), pii, key);
  return maskKeys(sanitize(value, pii, { key, parent: column.toLowerCase() }), pii, key);
}

/** Applies the export policy to one row. Pass the original cached row (never an already-masked one). */
export function applyPii(row: Record<string, unknown>, pii: PiiLevel, key?: Buffer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (STRIP.test(k)) continue;
    if (typeof v === "string") {
      if (v && pii !== "none" && EMAIL_COL.test(k)) out[k] = pseudonym(v, "email", key);
      else if (v && pii !== "none" && PHONE_COL.test(k)) out[k] = "[phone]";
      else if (v && pii === "strict" && (NAME_COL.test(k) || PERSON_COL.test(k))) out[k] = pseudonym(v, "person", key);
      // Free text (titles, labels, responses, IDs): secrets always, emails and phone numbers unless pii=none.
      else out[k] = maskText(v, pii, key);
      continue;
    }
    out[k] = v && typeof v === "object" && !(v instanceof Date) ? scrubNested(k, v, pii, key) : v;
  }
  return out;
}
