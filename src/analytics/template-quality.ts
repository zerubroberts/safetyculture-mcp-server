import type { CacheReader } from "../cache/contract.js";
import type { Period } from "../core/time.js";
import { buildResult, nameMaps } from "./common.js";
import { median, pct, round } from "./stats.js";
import {
  CONDITIONAL_PARENT_TYPES,
  FAILABLE_TYPES,
  FREE_TEXT_TYPES,
  completedInspections,
  isAnswered,
  isFailed,
  isNA,
  isPresented,
  itemsByInspection,
  templateKey,
  type Item,
} from "./trend.js";

/**
 * Template hygiene: which questions never fail, are always N/A, or are routinely skipped.
 * Item identity = normalised label within the template (item IDs change between template versions).
 */

export const CUT_MIN_ANSWERED = 200;
export const MIN_EVIDENCE = 10;
export const FIX_RATE = 50;

export interface TemplateQualityArgs {
  template_id: string;
  period: Period;
}

export interface TemplateItemRow {
  label: string;
  type: string;
  section?: string;
  times_presented: number;
  times_answered: number;
  failed: number;
  fail_rate: number | null;
  na: number;
  na_rate: number | null;
  blank: number | null;
  skip_rate: number | null;
  avg_text_length: number | null;
  bucket: "cut candidate" | "fix" | "keep";
  evidence: string;
}

interface Acc {
  label: string;
  types: Map<string, number>;
  section?: string;
  presented: number;
  answered: number;
  failed: number;
  na: number;
  /** Presentations where a blank can be judged a skip (not behind conditional logic). */
  judgeable: number;
  blank: number;
  textLen: number;
  textN: number;
}

export function computeTemplateQuality(cache: CacheReader, args: TemplateQualityArgs, now: Date) {
  const tkey = templateKey(args.template_id);
  const window = { from: args.period.from.getTime(), to: args.period.to.getTime() };
  const insps = completedInspections(cache, window, { template_ids: [args.template_id] });
  const items = itemsByInspection(cache, new Set(insps.map((i) => i.key)));

  const acc = new Map<string, Acc>();
  const duplicates = new Map<string, { label: string; max_copies: number; inspections: number }>();
  for (const arr of items.values()) {
    const typeById = new Map<string, string>();
    for (const i of arr) if (i.itemId) typeById.set(i.itemId, i.type);
    const parentOf = new Map<string, string | undefined>();
    for (const i of arr) if (i.itemId) parentOf.set(i.itemId, i.parentId);
    const conditional = (i: Item) => {
      let p = i.parentId;
      for (let d = 0; p && d < 50; d++) {
        if (CONDITIONAL_PARENT_TYPES.has(typeById.get(p) ?? "")) return true;
        p = parentOf.get(p);
      }
      return false;
    };
    const idsPerLabel = new Map<string, Set<string>>();
    for (const i of arr) {
      if (!isPresented(i) || !i.labelKey) continue;
      let a = acc.get(i.labelKey);
      if (!a) {
        a = { label: i.label.trim(), types: new Map(), section: i.category, presented: 0, answered: 0, failed: 0, na: 0, judgeable: 0, blank: 0, textLen: 0, textN: 0 };
        acc.set(i.labelKey, a);
      }
      a.types.set(i.type, (a.types.get(i.type) ?? 0) + 1);
      a.presented++;
      const answered = isAnswered(i);
      if (answered) a.answered++;
      if (isFailed(i)) a.failed++;
      if (isNA(i)) a.na++;
      if (!conditional(i)) {
        a.judgeable++;
        if (!answered) a.blank++;
      }
      if (answered && FREE_TEXT_TYPES.has(i.type)) {
        a.textLen += i.response.trim().length;
        a.textN++;
      }
      if (!i.repeated && i.itemId) {
        const s = idsPerLabel.get(i.labelKey) ?? new Set<string>();
        s.add(i.itemId);
        idsPerLabel.set(i.labelKey, s);
      }
    }
    for (const [k, s] of idsPerLabel) {
      if (s.size < 2) continue;
      const d = duplicates.get(k) ?? { label: acc.get(k)!.label, max_copies: 0, inspections: 0 };
      d.max_copies = Math.max(d.max_copies, s.size);
      d.inspections++;
      duplicates.set(k, d);
    }
  }

  const table: TemplateItemRow[] = [...acc.values()].map((a) => {
    const type = [...a.types.entries()].sort((x, y) => y[1] - x[1])[0]![0];
    const failRate = pct(a.failed, a.answered, 1);
    const naRate = pct(a.na, a.answered, 1);
    const skipRate = a.judgeable > 0 ? pct(a.blank, a.judgeable, 1) : null;
    let bucket: TemplateItemRow["bucket"] = "keep";
    let evidence: string;
    if (a.answered >= CUT_MIN_ANSWERED && a.failed === 0 && FAILABLE_TYPES.has(type)) {
      bucket = "cut candidate";
      evidence = `answered ${a.answered} times and never failed`;
    } else if (a.answered >= MIN_EVIDENCE && a.na === a.answered) {
      bucket = "cut candidate";
      evidence = `answered N/A all ${a.answered} times`;
    } else if (a.presented >= MIN_EVIDENCE && skipRate !== null && skipRate >= FIX_RATE) {
      bucket = "fix";
      evidence = `left blank ${a.blank} of ${a.judgeable} times (${skipRate}%)`;
    } else if (a.answered >= MIN_EVIDENCE && naRate !== null && naRate >= FIX_RATE) {
      bucket = "fix";
      evidence = `answered N/A ${a.na} of ${a.answered} times (${naRate}%)`;
    } else if (a.presented < MIN_EVIDENCE) {
      evidence = `only shown ${a.presented} times; too few to judge`;
    } else {
      evidence = `answered ${a.answered} times, failed ${a.failed}, N/A ${a.na}`;
    }
    return {
      label: a.label,
      type,
      section: a.section,
      times_presented: a.presented,
      times_answered: a.answered,
      failed: a.failed,
      fail_rate: failRate,
      na: a.na,
      na_rate: naRate,
      blank: a.judgeable > 0 ? a.blank : null,
      skip_rate: skipRate,
      avg_text_length: a.textN ? round(a.textLen / a.textN, 1) : null,
      bucket,
      evidence,
    };
  });
  const order = { "cut candidate": 0, fix: 1, keep: 2 } as const;
  table.sort((x, y) => order[x.bucket] - order[y.bucket] || y.times_answered - x.times_answered || x.label.localeCompare(y.label));

  const durations = insps.map((i) => i.duration).filter((d): d is number => d !== undefined);
  const names = nameMaps(cache);
  const tplName = insps.find((i) => i.templateName)?.templateName ?? [...names.templates.entries()].find(([id]) => templateKey(id) === tkey)?.[1];
  const count = (b: TemplateItemRow["bucket"]) => table.filter((r) => r.bucket === b).length;
  const dupList = [...duplicates.values()].sort((a, b) => b.inspections - a.inspections);

  const caveats: string[] = [];
  if (!insps.length) caveats.push("No completed inspections of this template in the period.");
  if (durations.length < insps.length) caveats.push(`${insps.length - durations.length} inspections have no recorded duration and are left out of the median duration.`);
  caveats.push("Blank answers are only counted as skips for items not behind conditional logic (smart fields); questions hidden by logic are not skips.");
  if (dupList.length) caveats.push(`${dupList.length} labels appear more than once in the same inspection; their rows combine several questions.`);

  const result = buildResult({
    version: "template-quality/1",
    period: args.period,
    filters: { template_id: args.template_id },
    cache,
    feeds: ["inspections", "inspection_items"],
    metrics: {
      template_name: tplName ?? null,
      inspections: insps.length,
      items: table.length,
      cut_candidates: count("cut candidate"),
      fix: count("fix"),
      keep: count("keep"),
      median_duration_seconds: durations.length ? round(median(durations), 0) : null,
      duplicate_labels: dupList.length,
    },
    table,
    method:
      `Per item (normalised label within the template), over completed inspections in the period. Fail rate = failed / answered; N/A rate = responses "N/A", "NA" or "not applicable" / answered; skip rate = blank / times shown outside conditional logic. ` +
      `"Cut candidate": answered >= ${CUT_MIN_ANSWERED} times and never failed (pass/fail-type questions only), or N/A every time (>= ${MIN_EVIDENCE} answers). "Fix": skip or N/A rate >= ${FIX_RATE}% (>= ${MIN_EVIDENCE} showings). Everything else "keep". Duration is the feed's duration field, read as seconds.`,
    caveats,
    now,
  });
  return {
    result: { ...result, duplicates: dupList },
    summary: `${insps.length} inspections of ${tplName ? `"${tplName}"` : "the template"} over ${args.period.label}: ${table.length} items, ${count("cut candidate")} cut candidates, ${count("fix")} to fix, ${count("keep")} keep; ${dupList.length} duplicate labels.`,
  };
}
