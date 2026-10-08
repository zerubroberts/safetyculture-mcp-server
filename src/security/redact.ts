import { createHmac, randomBytes } from "node:crypto";
import type { PiiLevel } from "../core/config.js";

/**
 * Keys that must never reach a model, whatever the PII level. These carry session hashes,
 * third-party support tokens or credentials (the WhoAmI endpoint returns several of them).
 */
const ALWAYS_STRIP = new Set([
  "kustomer_hash",
  "intercom_jwt",
  "intercom_hmac",
  "knock_info",
  "password",
  "api_token",
  "access_token",
  "refresh_token",
  "token",
  "secret",
  "signature_secret",
  "client_secret",
  "authorization",
]);

const CONTACT_KEYS = new Set(["email", "mobile_phone", "phone", "phone_number", "mobile", "user_email", "owner_email"]);
const NAME_KEYS = new Set([
  "firstname",
  "lastname",
  "first_name",
  "last_name",
  "full_name",
  "display_name",
  "name_of_user",
  "owner_name",
  "author_name",
  "creator_name",
  "assignee_name",
  "user_name",
  "inspector_name",
]);

const TOKEN_PATTERNS: RegExp[] = [
  /scapi_[A-Za-z0-9_\-.]{8,}/g,
  /Bearer\s+[A-Za-z0-9_\-.=]{12,}/gi,
  /\b[a-f0-9]{64}\b/g,
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w-])(?:\+|\()?\d[\d\s().-]{7,}\d(?![\w-])/g;

// Exact secret values known to this process (the configured API token, HTTP bearer, per-request
// tokens). Pattern matching alone misses tokens in non-standard formats.
const knownSecrets = new Set<string>();
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) knownSecrets.add(value);
}

/** Removes known secrets and anything that looks like an API token or bearer header from free text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of knownSecrets) if (out.includes(secret)) out = out.replaceAll(secret, "[redacted-secret]");
  for (const p of TOKEN_PATTERNS) out = out.replace(p, "[redacted-secret]");
  return out;
}

// Pseudonyms are keyed HMACs, not plain hashes: a plain hash of an email address can be reversed
// by hashing a list of guesses. The key is derived from the API token (or SC_PSEUDONYM_KEY), so
// pseudonyms are stable across restarts for one organisation but meaningless outside it.
let pseudonymKey: Buffer = randomBytes(32);

export const derivePseudonymKey = (seed: string): Buffer => createHmac("sha256", "safetyculture-mcp/pseudonym/v1").update(seed).digest();

/** Process default key (stdio: one organisation per process). HTTP passes a per-request key instead. */
export function setPseudonymKey(seed: string): void {
  pseudonymKey = derivePseudonymKey(seed);
}

export function pseudonym(value: string, kind: string, key: Buffer = pseudonymKey): string {
  const h = createHmac("sha256", key).update(`${kind}:${value.trim().toLowerCase()}`).digest("hex").slice(0, 10);
  return `${kind}_${h}`;
}

/**
 * Free-text phone detection is deliberately conservative: dates, timestamps, plain numeric IDs
 * and decimals must survive. Phone *fields* are masked by key name regardless (see CONTACT_KEYS).
 */
function looksLikePhone(m: string): boolean {
  const digits = m.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(m) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(m)) return false; // dates
  if (/^0[2-9]\d{8}$/.test(m)) return true; // national 10-digit numbers written without spaces (e.g. AU mobiles)
  if (/^\d+(\.\d+)?$/.test(m)) return false; // bare numbers / IDs / decimals
  return m.startsWith("+") || /^[(0]/.test(m) || /\d[\s().]\d/.test(m);
}

/** Masks secrets, emails and phone numbers inside free text (used for summaries too). */
export function maskText(s: string, pii: PiiLevel, key?: Buffer): string {
  let out = redactSecrets(s);
  if (pii !== "none") {
    out = out.replace(EMAIL, (m) => pseudonym(m, "email", key));
    out = out.replace(PHONE, (m) => (looksLikePhone(m) ? "[phone]" : m));
  }
  return out;
}

// Keys whose string value is a person's name in this server's projections and in API payloads.
const PERSON_VALUE_KEYS = new Set([
  ...NAME_KEYS,
  "user",
  "creator",
  "owner",
  "author",
  "inspector",
  "assignee",
  "created_by",
  "completed_by",
  "submitted_by",
  "updated_by",
  "person",
  "subject_user_first_name",
  "subject_user_last_name",
  "creator_user_name",
  "task_creator_name",
  "prepared_by",
  "personnel",
]);
// Containers whose objects (or strings) describe people: a "name" inside them is a person's name.
const PERSON_CONTEXT = new Set([
  "assignees",
  "collaborators",
  "users",
  "members",
  "people",
  "creator",
  "owner",
  "author",
  "inspector",
  "inspectors",
  "user",
  "by_person",
  "completed",
  "not_completed",
  "completed_users",
  "pending_users",
  "subject",
  "contributors",
]);

/**
 * Walks any JSON value and applies the privacy policy:
 * - always strips credential-like keys and token-shaped strings
 * - pii=contact (default): emails become stable pseudonyms, phone numbers are masked
 * - pii=strict: person names become stable pseudonyms too
 */
export function sanitize<T>(value: T, pii: PiiLevel, opts: { key?: Buffer; depth?: number; parent?: string } = {}): T {
  const depth = opts.depth ?? 0;
  const key = opts.key;
  if (depth > 40) return value;
  const personContext = Boolean(opts.parent && PERSON_CONTEXT.has(opts.parent));
  if (typeof value === "string") {
    if (pii === "strict" && personContext && value) return pseudonym(value, "person", key) as T;
    return maskText(value, pii, key) as T;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, pii, { key, depth: depth + 1, parent: opts.parent })) as T;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const isPerson = personContext || "user_id" in obj || "firstname" in obj;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (ALWAYS_STRIP.has(lk)) continue;
      if (pii !== "none" && CONTACT_KEYS.has(lk) && typeof v === "string" && v) {
        out[k] = lk.includes("email") ? pseudonym(v, "email", key) : "[phone]";
        continue;
      }
      if (pii === "strict" && typeof v === "string" && v && (PERSON_VALUE_KEYS.has(lk) || (isPerson && lk === "name"))) {
        out[k] = pseudonym(v, "person", key);
        continue;
      }
      out[k] = sanitize(v, pii, { key, depth: depth + 1, parent: lk });
    }
    return out as T;
  }
  return value;
}
