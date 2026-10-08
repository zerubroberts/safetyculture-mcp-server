import type { AnalyticResult, CacheReader } from "../cache/contract.js";
import { ids } from "../core/params.js";
import { parsePeriod } from "../core/time.js";
import { bool, buildResult, nameMaps, str } from "./common.js";
import { canon, DAY } from "./failed-items.js";

/**
 * Credential (licence / ticket) expiry radar.
 *
 * Feed fields relied on (api-ref feedservice_credentials):
 *   credentials: document_id, document_version_id, document_type_id, document_type_name, subject_user_id,
 *                subject_user_first_name, subject_user_last_name, expiry_date (YYYY-MM-DD, empty = no expiry),
 *                approval_status, modified_at, deleted
 *   users: id, firstname, lastname (name fallback)
 */

export type ExpiryBucket = "expired" | "within_7_days" | "within_30_days" | "within_90_days" | "later";

/** Days left = expiry date minus today's UTC date. 0 = expires today (still valid today, so not expired). */
export const bucketForDays = (d: number): ExpiryBucket =>
  d < 0 ? "expired" : d <= 7 ? "within_7_days" : d <= 30 ? "within_30_days" : d <= 90 ? "within_90_days" : "later";

export const CREDENTIALS_VERSION = "credential-radar/1";

export interface CredentialArgs {
  horizon?: string;
  credential_types?: string[];
  include_expired?: boolean;
}

export interface CredentialRow {
  person: string;
  user_id?: string;
  credential_type: string;
  type_id?: string;
  expiry_date: string;
  days_left: number;
  bucket: ExpiryBucket;
  approval_status?: string;
  document_id: string;
}

export function analyzeCredentialRadar(
  cache: CacheReader,
  args: CredentialArgs,
  now: Date,
): {
  summary: string;
  result: AnalyticResult<CredentialRow> & {
    by_person: Array<{ person: string; user_id?: string; expired: number; within_7_days: number; within_30_days: number; within_90_days: number; total: number }>;
    by_type: Array<{ credential_type: string; expired: number; within_7_days: number; within_30_days: number; within_90_days: number; total: number }>;
  };
} {
  const horizon = parsePeriod(args.horizon, now, "next 30 days");
  const includeExpired = args.include_expired ?? true;
  const feeds = ["credentials", "users"] as const;
  const filters = { horizon: args.horizon ?? "next 30 days", credential_types: args.credential_types, include_expired: includeExpired };
  const all = cache.rows("credentials");
  if (!all.length) {
    const result = buildResult<CredentialRow>({
      version: CREDENTIALS_VERSION,
      period: horizon,
      filters,
      cache,
      feeds: [...feeds],
      metrics: { expired: null, within_7_days: null, within_30_days: null, within_90_days: null },
      table: [],
      method: "Expiry radar needs the credentials feed; it has no rows.",
      caveats: ["No credential data: the credentials feed is empty (module unused, no access, or not synced). This does not mean nothing is expiring."],
      now,
    });
    return { summary: "No credential data: the credentials feed is empty, so expiries cannot be checked.", result: { ...result, by_person: [], by_type: [] } };
  }

  const users = nameMaps(cache).users;
  const userByCanon = new Map([...users.entries()].map(([k, v]) => [canon(k), v]));
  const typeFilter = args.credential_types?.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  // One row per document (latest modified version), then the latest-expiring credential per person + type:
  // a renewed licence supersedes the expired one it replaces.
  const docs = new Map<string, Record<string, unknown>>();
  let deleted = 0;
  for (const r of all) {
    if (bool(r.deleted)) {
      deleted++;
      continue;
    }
    const k = String(r.document_id ?? r.document_version_id ?? "");
    const prev = docs.get(k);
    if (!prev || String(r.modified_at ?? "") > String(prev.modified_at ?? "")) docs.set(k, r);
  }
  let noExpiry = 0;
  let badDate = 0;
  let typeExcluded = 0;
  const latest = new Map<string, { r: Record<string, unknown>; exp: number | null }>();
  for (const r of docs.values()) {
    const typeName = String(r.document_type_name ?? "").trim();
    if (typeFilter?.length && !typeFilter.some((t) => typeName.toLowerCase().includes(t) || canon(r.document_type_id) === canon(t))) {
      typeExcluded++;
      continue;
    }
    const e = str(r.expiry_date)?.trim();
    let exp: number | null = null;
    if (e) {
      const t = Date.parse(`${e.slice(0, 10)}T00:00:00Z`);
      if (!Number.isFinite(t)) {
        badDate++;
        continue;
      }
      exp = t;
    }
    const k = `${canon(r.subject_user_id)}|${canon(r.document_type_id) || typeName.toLowerCase()}`;
    const prev = latest.get(k);
    // null expiry = never expires, which beats any dated one.
    if (!prev || (prev.exp !== null && (exp === null || exp > prev.exp))) latest.set(k, { r, exp });
  }
  const superseded = docs.size - typeExcluded - badDate - latest.size;

  const table: CredentialRow[] = [];
  let beyond = 0;
  let expiredHidden = 0;
  for (const { r, exp } of latest.values()) {
    if (exp === null) {
      noExpiry++;
      continue;
    }
    const days = Math.round((exp - today) / DAY);
    const bucket = bucketForDays(days);
    if (bucket === "expired" && !includeExpired) {
      expiredHidden++;
      continue;
    }
    if (bucket !== "expired" && exp >= horizon.to.getTime()) {
      beyond++;
      continue;
    }
    const uid = str(r.subject_user_id);
    const person =
      [r.subject_user_first_name, r.subject_user_last_name].map((x) => str(x)?.trim()).filter(Boolean).join(" ") ||
      (uid ? (userByCanon.get(canon(uid)) ?? userByCanon.get(canon(ids.user(uid)))) : undefined) ||
      uid ||
      "(unknown person)";
    table.push({
      person,
      user_id: uid,
      credential_type: String(r.document_type_name ?? "") || "(unnamed type)",
      type_id: str(r.document_type_id),
      expiry_date: new Date(exp).toISOString().slice(0, 10),
      days_left: days,
      bucket,
      approval_status: str(r.approval_status),
      document_id: String(r.document_id ?? ""),
    });
  }
  table.sort((a, b) => a.days_left - b.days_left || a.person.localeCompare(b.person) || a.credential_type.localeCompare(b.credential_type));

  const counts = { expired: 0, within_7_days: 0, within_30_days: 0, within_90_days: 0 };
  for (const r of table) if (r.bucket !== "later") counts[r.bucket]++;
  const roll = <K extends string>(key: (r: CredentialRow) => string, label: K, extra: (r: CredentialRow) => Record<string, unknown>) => {
    const m = new Map<string, Record<string, unknown> & { expired: number; within_7_days: number; within_30_days: number; within_90_days: number; total: number }>();
    for (const r of table) {
      const k = key(r);
      let g = m.get(k);
      if (!g) m.set(k, (g = { [label]: k, ...extra(r), expired: 0, within_7_days: 0, within_30_days: 0, within_90_days: 0, total: 0 }));
      if (r.bucket !== "later") g[r.bucket]++;
      g.total++;
    }
    return [...m.values()].sort((a, b) => b.expired - a.expired || b.within_7_days - a.within_7_days || b.total - a.total || String(a[label]).localeCompare(String(b[label])));
  };
  const byPerson = roll((r) => r.person, "person", (r) => ({ user_id: r.user_id })) as unknown as Array<{
    person: string;
    user_id?: string;
    expired: number;
    within_7_days: number;
    within_30_days: number;
    within_90_days: number;
    total: number;
  }>;
  const byType = roll((r) => r.credential_type, "credential_type", () => ({})) as unknown as Array<{
    credential_type: string;
    expired: number;
    within_7_days: number;
    within_30_days: number;
    within_90_days: number;
    total: number;
  }>;

  const pending = table.filter((r) => r.approval_status && r.approval_status.toUpperCase() !== "APPROVED").length;
  const caveats: string[] = [];
  if (superseded > 0) caveats.push(`${superseded} older credentials were superseded by a later-expiring one of the same type for the same person and are not counted.`);
  if (noExpiry) caveats.push(`${noExpiry} current credentials have no expiry date and are not shown.`);
  if (badDate) caveats.push(`${badDate} credentials have an unreadable expiry date and were skipped.`);
  if (deleted) caveats.push(`${deleted} deleted credential records were ignored.`);
  if (pending) caveats.push(`${pending} listed credentials are not yet approved (approval_status other than APPROVED).`);
  if (!includeExpired && expiredHidden) caveats.push(`${expiredHidden} expired credentials are hidden (include_expired is false).`);
  caveats.push("Only people with a credential record appear; anyone missing a required credential entirely is not detected here.");

  const result = buildResult({
    version: CREDENTIALS_VERSION,
    period: horizon,
    filters,
    cache,
    feeds: [...feeds],
    metrics: { ...counts, listed: table.length, beyond_horizon: beyond, no_expiry_date: noExpiry, people: byPerson.length },
    table,
    method:
      "Days left = expiry date minus today's date (UTC). Expired = before today; buckets: 0-7, 8-30, 31-90 days. Only the latest-expiring credential per person and type counts; anything expiring on or after the horizon end is excluded.",
    caveats,
    now,
  });
  const summary = `${table.length} credentials need attention (${horizon.label}): ${counts.expired} expired, ${counts.within_7_days} within 7 days, ${counts.within_30_days} within 8-30 days, ${counts.within_90_days} within 31-90 days, across ${byPerson.length} people.`;
  return { summary, result: { ...result, by_person: byPerson, by_type: byType } };
}
