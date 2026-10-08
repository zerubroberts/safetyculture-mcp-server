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
const PHONE = /(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g;

/** Removes anything that looks like an API token or bearer header from free text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const p of TOKEN_PATTERNS) out = out.replace(p, "[redacted-secret]");
  return out;
}

// Pseudonyms are keyed HMACs, not plain hashes: a plain hash of an email address can be reversed
// by hashing a list of guesses. The key is derived from the API token (or SC_PSEUDONYM_KEY), so
// pseudonyms are stable across restarts for one organisation but meaningless outside it.
let pseudonymKey = randomBytes(32);

export function setPseudonymKey(seed: string): void {
  pseudonymKey = createHmac("sha256", "safetyculture-mcp/pseudonym/v1").update(seed).digest();
}

export function pseudonym(value: string, kind: string): string {
  const h = createHmac("sha256", pseudonymKey).update(`${kind}:${value.trim().toLowerCase()}`).digest("hex").slice(0, 10);
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
  if (/^\d+(\.\d+)?$/.test(m)) return false; // bare numbers / IDs / decimals
  return m.startsWith("+") || /^[(0]/.test(m) || /\d[\s().]\d/.test(m);
}

function maskString(s: string, pii: PiiLevel): string {
  let out = redactSecrets(s);
  if (pii !== "none") {
    out = out.replace(EMAIL, (m) => pseudonym(m, "email"));
    out = out.replace(PHONE, (m) => (looksLikePhone(m) ? "[phone]" : m));
  }
  return out;
}

/**
 * Walks any JSON value and applies the privacy policy:
 * - always strips credential-like keys and token-shaped strings
 * - pii=contact (default): emails become stable pseudonyms, phone numbers are masked
 * - pii=strict: person names become stable pseudonyms too
 */
export function sanitize<T>(value: T, pii: PiiLevel, depth = 0): T {
  if (depth > 40) return value;
  if (typeof value === "string") return maskString(value, pii) as T;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, pii, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (ALWAYS_STRIP.has(key)) continue;
      if (pii !== "none" && CONTACT_KEYS.has(key) && typeof v === "string" && v) {
        out[k] = key.includes("email") ? pseudonym(v, "email") : "[phone]";
        continue;
      }
      if (pii === "strict" && NAME_KEYS.has(key) && typeof v === "string" && v) {
        out[k] = pseudonym(v, "person");
        continue;
      }
      out[k] = sanitize(v, pii, depth + 1);
    }
    return out as T;
  }
  return value;
}
