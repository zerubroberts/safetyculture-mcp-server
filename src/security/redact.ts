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
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w:-])(?:\+|\()?\d[\d\s().-]{7,}\d(?![\w:-])/g;

// Exact secret values known to this process (the configured API token, HTTP bearer, per-request
// tokens). Pattern matching alone misses tokens in non-standard formats.
const knownSecrets = new Set<string>();
// Operator secrets (startup token, HTTP bearer) are pinned: per-request tokens can never evict them.
const pinnedSecrets = new Set<string>();
const MAX_KNOWN_SECRETS = 200;
export function registerSecret(value: string | undefined, opts: { pin?: boolean } = {}): void {
  if (!value || value.length < 8) return;
  if (opts.pin) {
    pinnedSecrets.add(value);
    return;
  }
  if (pinnedSecrets.has(value)) return;
  knownSecrets.delete(value);
  knownSecrets.add(value);
  // Per-request HTTP tokens must not grow the set forever: drop the oldest.
  while (knownSecrets.size > MAX_KNOWN_SECRETS) knownSecrets.delete(knownSecrets.values().next().value as string);
}

/** Removes known secrets and anything that looks like an API token or bearer header from free text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const set of [pinnedSecrets, knownSecrets]) for (const secret of set) if (out.includes(secret)) out = out.replaceAll(secret, "[redacted-secret]");
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
function looksLikePhone(raw: string): boolean {
  const m = raw.replace(/^\(/, "");
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(m) && !raw.startsWith("+")) return false; // ISO dates, even after "("
  const digits = m.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (/^\d{4}[-/. ]\d{1,2}[-/. ]\d{1,2}$/.test(m) || /^\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}$/.test(m)) return false; // dates, incl. space-separated
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(m) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(m)) return false; // dates
  if (/^\d{1,2} \d{4} \d{1,2}$/.test(m)) return false; // "15 2026 10" fragments of "Jan 15 2026 10:20"
  if (/^0[2-9]\d{8}$/.test(m)) return true; // national 10-digit numbers written without spaces (e.g. AU mobiles)
  if (/^\d+(\.\d+)?$/.test(m)) return false; // bare numbers / IDs / decimals
  return m.startsWith("+") || /^[(0]/.test(m) || /\d[\s().]\d/.test(m);
}

/** Replaces collected originals with their pseudonyms, longest first ("Alex Carter" before "Alex"). */
export function applyReplacements(text: string, replaced: Map<string, string>): string {
  let out = text.normalize("NFC");
  for (const [original, alias] of [...replaced.entries()].sort((a, b) => b[0].length - a[0].length)) {
    // Case-insensitive and accent-normalised (NFC), so "ZELDA QUORN" is caught when the record says
    // "Zelda Quorn"; whole words only, so a short name like "Al" never rewrites "Total".
    if (original.length < 2) continue;
    const escaped = original.normalize("NFC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escaped}(?![\\p{L}\\p{N}\\p{M}])`, "giu"), () => alias);
  }
  return out;
}

/**
 * maskText plus, at strict, names inside any JSON quoted in the text (upstream error bodies,
 * audit entries): the JSON is run through sanitize() and the names it pseudonymises are replaced
 * in the whole string. Names in plain prose without structure cannot be detected.
 */
export function maskFreeText(s: string, pii: PiiLevel, key?: Buffer): string {
  let out = maskText(s, pii, key);
  if (pii !== "strict") return out;
  const replaced = new Map<string, string>();
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
    const a = s.indexOf(open);
    const b = s.lastIndexOf(close);
    if (a < 0 || b <= a) continue;
    try {
      sanitize(JSON.parse(s.slice(a, b + 1)), pii, { key, collect: replaced });
    } catch {
      // not JSON: nothing structured to learn names from
    }
  }
  return applyReplacements(out, replaced);
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
  "by",
  "signed_by",
  "signature_name",
  "owner_full_name",
  "user_full_name",
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

/** Object keys whose presence marks the object as describing a person. */
const PERSON_ID_KEY = /(^|_)(user|assignee|creator|owner|author|subject_user|collaborator)_id$/;

interface SanitizeOpts {
  key?: Buffer;
  depth?: number;
  parent?: string;
  /** Strict mode: receives original -> pseudonym for every person name replaced (used on summaries). */
  collect?: Map<string, string>;
}

/**
 * Walks any JSON value and applies the privacy policy:
 * - always strips credential-like keys and token-shaped strings
 * - pii=contact (default): emails become stable pseudonyms, phone numbers are masked
 * - pii=strict: person names become stable pseudonyms too (person-name keys, "name" inside person
 *   objects or person containers, and signature answers)
 */
export function sanitize<T>(value: T, pii: PiiLevel, opts: SanitizeOpts = {}): T {
  const depth = opts.depth ?? 0;
  const { key, collect } = opts;
  if (depth > 40) return value;
  const person = (v: string) => {
    const alias = pseudonym(v, "person", key);
    collect?.set(v, alias);
    return alias;
  };
  const personContext = Boolean(opts.parent && PERSON_CONTEXT.has(opts.parent));
  if (typeof value === "string") {
    if (pii === "strict" && personContext && value) return person(value) as T;
    return maskText(value, pii, key) as T;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, pii, { key, collect, depth: depth + 1, parent: opts.parent })) as T;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).map((k) => k.toLowerCase());
    const isPerson = personContext || keys.some((k) => PERSON_ID_KEY.test(k)) || keys.includes("firstname") || keys.includes("first_name");
    const isSignature = typeof obj.type === "string" && /signature/i.test(obj.type);
    // Analytics rows grouped by a person (assignee, inspector) carry group_kind: "person".
    const isPersonRow = obj.group_kind === "person" || obj.kind === "person";
    if (pii === "strict" && collect) {
      // Record full names too, so "Alex Carter" in a summary is replaced as a whole.
      for (const [f, l] of [["firstname", "lastname"], ["first_name", "last_name"], ["subject_user_first_name", "subject_user_last_name"]] as const) {
        const first = obj[f];
        const last = obj[l];
        if (typeof first === "string" && typeof last === "string" && first && last)
          collect.set(`${first} ${last}`, `${pseudonym(first, "person", key)} ${pseudonym(last, "person", key)}`);
      }
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      if (ALWAYS_STRIP.has(lk)) continue;
      if (pii !== "none" && CONTACT_KEYS.has(lk) && typeof v === "string" && v) {
        out[k] = lk.includes("email") ? pseudonym(v, "email", key) : "[phone]";
        continue;
      }
      if (
        pii === "strict" &&
        typeof v === "string" &&
        v &&
        (PERSON_VALUE_KEYS.has(lk) || (isPerson && lk === "name") || (isSignature && (lk === "response" || lk === "answer" || lk === "value")) ||
          (isPersonRow && (lk === "group" || lk === "label" || lk === "name" || lk === "group_name")))
      ) {
        out[k] = person(v);
        continue;
      }
      out[k] = sanitize(v, pii, { key, collect, depth: depth + 1, parent: lk });
    }
    return out as T;
  }
  return value;
}
