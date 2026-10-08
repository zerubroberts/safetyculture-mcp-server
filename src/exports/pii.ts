import type { PiiLevel } from "../core/config.js";
import { pseudonym } from "../security/redact.js";

/**
 * Column-based privacy policy for exported files (same levels as tool output, see SC_PII):
 * - none: values as stored
 * - contact (default): email columns become stable pseudonyms, phone columns are masked
 * - strict: person-name columns become stable pseudonyms too
 * Applied by column name only, so dates and IDs in other columns are never altered.
 */

const STRIP = /^(password|api_token|access_token|refresh_token|token|secret|signature_secret|client_secret|authorization)$/i;
const EMAIL_COL = /(^|_)e?mail$|email/i;
const PHONE_COL = /(^|_)(phone|mobile|phone_number|mobile_phone)$/i;
const NAME_COL =
  /^(firstname|lastname|first_name|last_name|full_name|display_name|owner_name|author_name|creator_name|creator_user_name|task_creator_name|assignee_name|user_name|inspector_name|prepared_by|personnel|subject_user_first_name|subject_user_last_name|userfirstname|userlastname|useremail)$/i;

export function applyPii(row: Record<string, unknown>, pii: PiiLevel): Record<string, unknown> {
  if (pii === "none") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (!STRIP.test(k)) out[k] = v;
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (STRIP.test(k)) continue;
    if (typeof v === "string" && v) {
      if (EMAIL_COL.test(k)) {
        out[k] = pseudonym(v, "email");
        continue;
      }
      if (PHONE_COL.test(k)) {
        out[k] = "[phone]";
        continue;
      }
      if (pii === "strict" && NAME_COL.test(k) && !EMAIL_COL.test(k)) {
        out[k] = pseudonym(v, "person");
        continue;
      }
    }
    out[k] = v;
  }
  return out;
}

/** A person's display name under the policy (names only hidden at strict). */
export function personName(name: string | undefined, pii: PiiLevel): string | undefined {
  if (!name) return undefined;
  return pii === "strict" ? pseudonym(name, "person") : name;
}

export function personEmail(email: string | undefined, pii: PiiLevel): string | undefined {
  if (!email) return undefined;
  return pii === "none" ? email : pseudonym(email, "email");
}
