import type { AnalyticResult, CacheReader } from "../cache/contract.js";
import { links } from "../core/params.js";
import { parsePeriod, type Period } from "../core/time.js";
import { bool, buildResult, nameMaps, num, str } from "./common.js";
import { pct } from "./stats.js";

/**
 * Inspection and inspection-item helpers shared by the core analytics, plus the failed-items Pareto.
 *
 * Feed fields relied on (docs/api-shapes.md, api-ref thepubservice_feedinspections / _feedinspectionitems):
 *   inspections: id, archived, date_completed, site_id, template_id, template_name, owner_id, owner_name,
 *                score_percentage, max_score
 *   inspection_items: id, audit_id, template_id, label, response, type, is_failed_response, inactive
 */

export const DAY = 86_400_000;

/** Canonical form of a Mitti ID so prefixed (audit_/template_/user_...) and bare UUID forms compare equal. */
export const canon = (id: unknown): string =>
  String(id ?? "")
    .trim()
    .replace(/^(audit|template|user|role|location|site)_/i, "")
    .replaceAll("-", "")
    .toLowerCase();

export const idIn = (value: unknown, allowed?: string[]): boolean => {
  if (!allowed?.length) return true;
  if (value === undefined || value === null || value === "") return false;
  const c = canon(value);
  return allowed.some((a) => canon(a) === c);
};

export interface Inspection {
  id: string;
  key: string;
  site_id?: string;
  template_id?: string;
  template_name?: string;
  owner_id?: string;
  owner_name?: string;
  completed_at: string;
  completed_ms: number;
  /** score_percentage, only when the inspection is scored (max_score > 0). */
  score_pct?: number;
}

export interface InspectionFilters {
  site_ids?: string[];
  template_ids?: string[];
}

/**
 * Completed, non-archived inspections whose date_completed falls in the period (all periods if omitted).
 * Archived inspections are excluded, matching the Mitti web app's default lists.
 */
export function completedInspections(cache: CacheReader, p: Period | undefined, f: InspectionFilters = {}): Map<string, Inspection> {
  const out = new Map<string, Inspection>();
  for (const r of cache.rows("inspections")) {
    if (bool(r.archived)) continue;
    const completed = str(r.date_completed);
    if (!completed) continue;
    const ms = Date.parse(completed);
    if (!Number.isFinite(ms)) continue;
    if (p && (ms < p.from.getTime() || ms >= p.to.getTime())) continue;
    if (!idIn(r.site_id, f.site_ids) || !idIn(r.template_id, f.template_ids)) continue;
    const maxScore = num(r.max_score);
    const scorePct = num(r.score_percentage);
    const id = String(r.id);
    out.set(canon(id), {
      id,
      key: canon(id),
      site_id: str(r.site_id) || undefined,
      template_id: str(r.template_id) || undefined,
      template_name: str(r.template_name) || undefined,
      owner_id: str(r.owner_id) || undefined,
      owner_name: str(r.owner_name) || undefined,
      completed_at: completed,
      completed_ms: ms,
      score_pct: maxScore !== undefined && maxScore > 0 && scorePct !== undefined ? scorePct : undefined,
    });
  }
  return out;
}

/** Item types that never carry a pass/fail answer, so they are not part of the failed-item rate denominator. */
export const NON_ANSWER_TYPES = new Set([
  "section",
  "category",
  "information",
  "media",
  "signature",
  "drawing",
  "text",
  "textsingle",
  "datetime",
  "address",
  "smartfield",
  "dynamicfield",
]);

/** An item counts as answered when it is active, has a non-empty response and is not a structural/free-text type. */
export function isAnswered(item: Record<string, unknown>): boolean {
  if (bool(item.inactive)) return false;
  const type = String(item.type ?? "").toLowerCase();
  if (NON_ANSWER_TYPES.has(type)) return false;
  return (str(item.response) ?? "").trim() !== "";
}

/** Failed = answered and flagged is_failed_response. Failed is always a subset of answered, so rates stay within 0-100%. */
export const isFailed = (item: Record<string, unknown>) => isAnswered(item) && bool(item.is_failed_response);

export const normLabel = (label: unknown) =>
  String(label ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

export interface JoinedItem {
  item: Record<string, unknown>;
  insp: Inspection;
  failed: boolean;
}

/** Answered items belonging to the given inspections. `orphans` counts items whose inspection is not in the map. */
export function answeredItems(cache: CacheReader, insp: Map<string, Inspection>): { items: JoinedItem[]; failed: number; answered: number } {
  const items: JoinedItem[] = [];
  let failed = 0;
  for (const it of cache.rows("inspection_items")) {
    const i = insp.get(canon(it.audit_id));
    if (!i || !isAnswered(it)) continue;
    const f = bool(it.is_failed_response);
    if (f) failed++;
    items.push({ item: it, insp: i, failed: f });
  }
  return { items, failed, answered: items.length };
}

/** Failed-item rate over the given inspections: failed answered items / answered items. */
export function failedRate(cache: CacheReader, insp: Map<string, Inspection>) {
  const { failed, answered } = answeredItems(cache, insp);
  return { failed, answered, rate_pct: pct(failed, answered, 2) };
}

export const FAILED_ITEMS_VERSION = "failed-items/1";

export interface FailedItemsArgs {
  query?: string;
  template_ids?: string[];
  site_ids?: string[];
  period?: string;
  group_by?: "item" | "template" | "site" | "inspector";
  top?: number;
}

export interface ParetoRow {
  group: string;
  key: string;
  template?: string;
  failed: number;
  share_pct: number | null;
  cumulative_share_pct: number | null;
  answered: number;
  failure_rate_pct: number | null;
  example_inspections: Array<{ id: string; link: string }>;
}

/** Builds the case-insensitive matcher for `a|b|c` queries (plain text alternatives, not regex). */
export function queryMatcher(q?: string): ((s: unknown) => boolean) | undefined {
  const alts = (q ?? "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!alts.length) return undefined;
  return (s) => {
    const v = String(s ?? "").toLowerCase();
    return alts.some((a) => v.includes(a));
  };
}

export function analyzeFailedItems(cache: CacheReader, args: FailedItemsArgs, now: Date): { summary: string; result: AnalyticResult<ParetoRow> } {
  const period = parsePeriod(args.period, now, "last 90 days");
  const groupBy = args.group_by ?? "item";
  const top = args.top ?? 20;
  const match = queryMatcher(args.query);
  const insp = completedInspections(cache, period, { site_ids: args.site_ids, template_ids: args.template_ids });
  const names = nameMaps(cache);
  const { items } = answeredItems(cache, insp);

  const identity = (j: JoinedItem) => `${canon(j.item.template_id ?? j.insp.template_id)}::${normLabel(j.item.label)}`;
  const groupKey = (j: JoinedItem): string => {
    if (groupBy === "template") return canon(j.item.template_id ?? j.insp.template_id) || "(none)";
    if (groupBy === "site") return j.insp.site_id ? canon(j.insp.site_id) : "(no site)";
    if (groupBy === "inspector") return j.insp.owner_id ? canon(j.insp.owner_id) : "(unknown)";
    return identity(j);
  };

  // A failed row is selected when its label or response matches the query. For item grouping the
  // denominator is every answer of the selected item identities; for other groupings it is every answer
  // of the selected identities within that group (so the rate reads "how often these questions fail here").
  const selectedIds = new Set<string>();
  const selectedFailed: JoinedItem[] = [];
  for (const j of items) {
    if (!j.failed) continue;
    if (match && !match(j.item.label) && !match(j.item.response)) continue;
    selectedFailed.push(j);
    selectedIds.add(identity(j));
  }
  const denomPool = match ? items.filter((j) => selectedIds.has(identity(j))) : items;

  interface Acc { label: string; template?: string; failed: number; answered: number; examples: string[]; latest: Map<string, number> }
  const groups = new Map<string, Acc>();
  const acc = (j: JoinedItem): Acc => {
    const k = groupKey(j);
    let a = groups.get(k);
    if (!a) {
      const tplId = String(j.item.template_id ?? j.insp.template_id ?? "");
      const tplName = names.templates.get(tplId) ?? j.insp.template_name ?? tplId;
      const label =
        groupBy === "item"
          ? String(j.item.label ?? "(no label)").trim()
          : groupBy === "template"
            ? tplName || "(no template)"
            : groupBy === "site"
              ? j.insp.site_id
                ? (names.sites.get(j.insp.site_id) ?? j.insp.site_id)
                : "(no site)"
              : j.insp.owner_id
                ? (j.insp.owner_name ?? names.users.get(j.insp.owner_id) ?? j.insp.owner_id)
                : "(unknown inspector)";
      a = { label, template: groupBy === "item" ? tplName : undefined, failed: 0, answered: 0, examples: [], latest: new Map() };
      groups.set(k, a);
    }
    return a;
  };
  for (const j of denomPool) acc(j).answered++;
  for (const j of selectedFailed) {
    const a = acc(j);
    a.failed++;
    const prev = a.latest.get(j.insp.id);
    if (prev === undefined || j.insp.completed_ms > prev) a.latest.set(j.insp.id, j.insp.completed_ms);
  }

  const totalFailed = selectedFailed.length;
  const ranked = [...groups.entries()]
    .filter(([, a]) => a.failed > 0)
    .sort((x, y) => y[1].failed - x[1].failed || x[1].label.localeCompare(y[1].label) || x[0].localeCompare(y[0]));
  let cum = 0;
  const table: ParetoRow[] = ranked.slice(0, top).map(([key, a]) => {
    cum += a.failed;
    const examples = [...a.latest.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3);
    return {
      group: a.label,
      key,
      template: a.template,
      failed: a.failed,
      share_pct: pct(a.failed, totalFailed),
      cumulative_share_pct: pct(cum, totalFailed),
      answered: a.answered,
      failure_rate_pct: pct(a.failed, a.answered),
      example_inspections: examples.map(([id]) => ({ id, link: links.inspection(id) })),
    };
  });

  const answeredTotal = denomPool.length;
  const caveats: string[] = [];
  if (!insp.size) caveats.push("No completed inspections match the period and filters.");
  if (ranked.length > top) caveats.push(`Showing the top ${top} of ${ranked.length} groups with failures; shares are of all ${totalFailed} failed items.`);
  caveats.push("An item is identified by its normalised label within a template, so renamed questions appear as separate items.");
  if (match) caveats.push("Text matching is a plain case-insensitive substring search on item label and response; it can miss synonyms and match unrelated text.");

  const result = buildResult({
    version: FAILED_ITEMS_VERSION,
    period,
    filters: { query: args.query, template_ids: args.template_ids, site_ids: args.site_ids, group_by: groupBy, top },
    cache,
    feeds: ["inspections", "inspection_items"],
    metrics: {
      inspections: insp.size,
      failed_items: totalFailed,
      answered_items: answeredTotal,
      failure_rate_pct: pct(totalFailed, answeredTotal),
      groups_with_failures: ranked.length,
      top_group_share_pct: table[0]?.share_pct ?? null,
    },
    table,
    method:
      "Failed items are answered items flagged is_failed_response in completed, non-archived inspections whose completion date is in the period. Share = group failed / all matching failed; failure rate = group failed / answered items of the same questions in that group.",
    caveats,
    now,
  });
  const lead = table[0] ? ` Top: "${table[0].group}" with ${table[0].failed} (${table[0].share_pct}% of failures).` : "";
  const summary = `${totalFailed} failed items out of ${answeredTotal} answered (${pct(totalFailed, answeredTotal) ?? "n/a"}%) across ${insp.size} completed inspections, ${period.label}, in ${ranked.length} ${groupBy} groups.${lead}`;
  return { summary, result };
}
