import type { CacheReader } from "../cache/contract.js";
import type { Period } from "../core/time.js";
import { bounded, buildResult, feedProblem, groupBy, nameMaps, unavailableSentence } from "./common.js";
import { median, pct, round } from "./stats.js";
import { completedInspections, itemCounts, itemsByInspection, userKey, type Insp, type ScopeFilter } from "./trend.js";

/** Inspector (inspection owner) activity. Descriptive only: volume depends on role and roster. */

export const FAST_SHARE = 0.25;
export const MIN_TEMPLATE_DURATIONS = 10;

/** Median duration per template, only for templates with at least `min` inspections that have a duration. */
export function templateMedianDurations(insps: Insp[], min = MIN_TEMPLATE_DURATIONS): Map<string, { median: number; n: number }> {
  const out = new Map<string, { median: number; n: number }>();
  for (const [t, arr] of groupBy(insps, (i) => i.templateKey ?? "")) {
    if (!t) continue;
    const d = arr.map((i) => i.duration).filter((x): x is number => x !== undefined);
    if (d.length >= min) out.set(t, { median: median(d), n: d.length });
  }
  return out;
}

export interface InspectorArgs extends ScopeFilter {
  period: Period;
  /** Max inspector rows returned (default 50); metrics always cover every inspector. */
  limit?: number;
}

export interface InspectorRow {
  inspector_id: string;
  inspector_name: string;
  inspections: number;
  templates: number;
  median_duration_seconds: number | null;
  answered_items: number | null;
  failed_items: number | null;
  failed_item_rate: number | null;
  expected_rate_same_templates: number | null;
  difference_pp: number | null;
  very_fast: number;
  very_fast_eligible: number;
  very_fast_share: number | null;
}

export function computeInspectorActivity(cache: CacheReader, args: InspectorArgs, now: Date) {
  const filters = { site_ids: args.site_ids, template_ids: args.template_ids };
  const feeds = ["inspections", "inspection_items", "users"] as const;
  // Unreadable inspections feed: no activity figures at all (an empty table would read as nobody inspecting).
  const noInsp = feedProblem(cache, "inspections");
  if (noInsp) {
    const result = buildResult<InspectorRow>({
      version: "inspector-activity/1",
      period: args.period,
      filters,
      cache,
      feeds: [...feeds],
      metrics: { inspectors: null, inspections: null, templates_with_duration_baseline: null },
      table: [],
      method: "Inspector activity needs the inspections feed; it could not be read, so no figures are computed.",
      caveats: [`No inspector figures: ${noInsp}. This is not zero inspections.`],
      now,
    });
    return { result: { ...result, total: 0, truncated: false }, summary: unavailableSentence("Inspector figures", noInsp) };
  }
  // Unreadable items feed: item counts and rates per inspector are null, not 0.
  const noItems = feedProblem(cache, "inspection_items");
  const window = { from: args.period.from.getTime(), to: args.period.to.getTime() };
  const insps = completedInspections(cache, window, args);
  const counts = itemCounts(itemsByInspection(cache, new Set(insps.map((i) => i.key))));
  const names = nameMaps(cache);
  const userNames = new Map([...names.users.entries()].map(([id, n]) => [userKey(id)!, n]));

  // Organisation-wide failed-item rate per template, over the same scope and period.
  const tplRate = new Map<string, { answered: number; failed: number }>();
  for (const i of insps) {
    const c = counts.get(i.key);
    if (!c) continue;
    const t = tplRate.get(i.templateKey ?? "") ?? { answered: 0, failed: 0 };
    t.answered += c.answered;
    t.failed += c.failed;
    tplRate.set(i.templateKey ?? "", t);
  }
  const medians = templateMedianDurations(insps);

  const table: InspectorRow[] = [];
  for (const [owner, arr] of groupBy(insps, (i) => i.ownerKey ?? "")) {
    let answered = 0;
    let failed = 0;
    let expected = 0;
    let fast = 0;
    let eligible = 0;
    for (const i of arr) {
      const c = counts.get(i.key);
      if (c) {
        answered += c.answered;
        failed += c.failed;
        const t = tplRate.get(i.templateKey ?? "");
        if (t && t.answered > 0) expected += c.answered * (t.failed / t.answered);
      }
      const m = medians.get(i.templateKey ?? "");
      if (m && i.duration !== undefined) {
        eligible++;
        if (i.duration < FAST_SHARE * m.median) fast++;
      }
    }
    const durations = arr.map((i) => i.duration).filter((d): d is number => d !== undefined);
    const rate = noItems ? null : pct(failed, answered, 1);
    const exp = !noItems && answered > 0 ? round((100 * expected) / answered, 1) : null;
    table.push({
      inspector_id: arr[0]!.ownerId ?? "(unknown)",
      inspector_name: arr.find((i) => i.ownerName)?.ownerName ?? userNames.get(owner) ?? (owner || "(unknown)"),
      inspections: arr.length,
      templates: new Set(arr.map((i) => i.templateKey)).size,
      median_duration_seconds: durations.length ? round(median(durations), 0) : null,
      answered_items: noItems ? null : answered,
      failed_items: noItems ? null : failed,
      failed_item_rate: rate,
      expected_rate_same_templates: exp,
      difference_pp: rate !== null && exp !== null ? round(rate - exp, 1) : null,
      very_fast: fast,
      very_fast_eligible: eligible,
      very_fast_share: pct(fast, eligible, 1),
    });
  }
  table.sort((a, b) => b.inspections - a.inspections || a.inspector_name.localeCompare(b.inspector_name) || a.inspector_id.localeCompare(b.inspector_id));
  const shown = bounded(table, args.limit);
  const caveats = [
    "Inspection volume depends on role, roster and assigned sites; this is not a performance score.",
    "A lower failed-item rate than expected can mean safer areas as easily as less thorough inspections; treat differences as prompts for a conversation.",
    "Duration is the feed's duration field, read as seconds.",
  ];
  if (noItems) caveats.push(`Answered items, failed items and failed-item rates are not reported: ${noItems}. This is not a 0% rate.`);
  if (shown.truncated)
    caveats.push(`Showing the ${shown.rows.length} inspectors with the most inspections out of ${shown.total}; metrics cover all ${shown.total}. Raise limit or filter by site or template to see the rest.`);

  const result = buildResult({
    version: "inspector-activity/1",
    period: args.period,
    filters,
    cache,
    feeds: [...feeds],
    metrics: {
      inspectors: table.length,
      inspections: insps.length,
      templates_with_duration_baseline: medians.size,
    },
    table: shown.rows,
    method:
      `Inspector = inspection owner (owner_id). Failed-item rate = failed / answered items on their completed inspections. Expected rate = the organisation's failed-item rate per template, weighted by that inspector's answered items on each template, so people are compared on the same template mix. ` +
      `Very fast = duration under ${FAST_SHARE * 100}% of the template's median duration (only templates with >= ${MIN_TEMPLATE_DURATIONS} timed inspections).`,
    caveats,
    now,
  });
  return {
    result: { ...result, total: shown.total, truncated: shown.truncated },
    summary:
      `${table.length} inspectors completed ${insps.length} inspections over ${args.period.label}` +
      (shown.truncated ? ` (top ${shown.rows.length} by volume listed)` : "") +
      ". Descriptive activity only, not a performance score." +
      (noItems ? ` ${unavailableSentence("Failed-item figures", noItems)}` : ""),
  };
}
