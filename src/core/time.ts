import { ToolError } from "./errors.js";

export interface Period {
  from: Date;
  to: Date;
  label: string;
}

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Parses human period strings into a UTC [from, to) window.
 * Accepts: "last 30 days", "past 2 weeks", "30d", "12w", "6m", "1y", "today", "yesterday",
 * "this week|month|quarter|year", "last week|month|quarter|year", "ytd", "mtd",
 * "2026", "2026-07", "2026-Q3", "2026-07-01..2026-09-30" (also "to" / " - ").
 */
export function parsePeriod(input: string | undefined, now = new Date(), fallback = "last 30 days"): Period {
  const raw = (input ?? fallback).trim().toLowerCase();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const mk = (from: Date, to: Date, label = raw): Period => ({ from, to, label: `${label} (${iso(from)} to ${iso(addDays(to, -1))})` });

  let m: RegExpMatchArray | null;

  if ((m = raw.match(/^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|–|—|\s-\s)\s*(\d{4}-\d{2}-\d{2})$/))) {
    const from = new Date(`${m[1]}T00:00:00Z`);
    const to = addDays(new Date(`${m[2]}T00:00:00Z`), 1);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new ToolError(`Invalid date range "${input}".`);
    return mk(from, to, "custom range");
  }
  if ((m = raw.match(/^(\d{4}-\d{2}-\d{2})$/))) {
    const from = new Date(`${m[1]}T00:00:00Z`);
    return mk(from, addDays(from, 1), "day");
  }
  if ((m = raw.match(/^(\d{4})-q([1-4])$/))) {
    const y = Number(m[1]);
    const q = Number(m[2]) - 1;
    return mk(new Date(Date.UTC(y, q * 3, 1)), new Date(Date.UTC(y, q * 3 + 3, 1)), `${y} Q${q + 1}`);
  }
  if ((m = raw.match(/^(\d{4})-(\d{2})$/))) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return mk(new Date(Date.UTC(y, mo, 1)), new Date(Date.UTC(y, mo + 1, 1)), "month");
  }
  if ((m = raw.match(/^(\d{4})$/))) {
    const y = Number(m[1]);
    return mk(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)), "year");
  }
  if ((m = raw.match(/^(?:last|past|previous)?\s*(\d+)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months|y|yr|year|years)$/))) {
    const n = Number(m[1]);
    const unit = m[2]![0];
    if (unit === "d") return mk(addDays(tomorrow, -n), tomorrow);
    if (unit === "w") return mk(addDays(tomorrow, -7 * n), tomorrow);
    if (unit === "m") return mk(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - n, today.getUTCDate() + 1)), tomorrow);
    return mk(new Date(Date.UTC(today.getUTCFullYear() - n, today.getUTCMonth(), today.getUTCDate() + 1)), tomorrow);
  }

  if ((m = raw.match(/^(?:next|coming)\s*(\d+)\s*(d|day|days|w|wk|week|weeks|m|mo|month|months)$/))) {
    const n = Number(m[1]);
    const unit = m[2]![0];
    const days = unit === "d" ? n : unit === "w" ? 7 * n : 0;
    const to = days ? addDays(tomorrow, days) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + n, today.getUTCDate() + 1));
    return mk(today, to);
  }

  const y = today.getUTCFullYear();
  const mo = today.getUTCMonth();
  const q = Math.floor(mo / 3);
  const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
  switch (raw) {
    case "today":
      return mk(today, tomorrow);
    case "yesterday":
      return mk(addDays(today, -1), today);
    case "this week":
    case "wtd":
      return mk(addDays(today, -dow), tomorrow);
    case "last week":
      return mk(addDays(today, -dow - 7), addDays(today, -dow));
    case "this month":
    case "mtd":
      return mk(new Date(Date.UTC(y, mo, 1)), tomorrow);
    case "last month":
      return mk(new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(y, mo, 1)));
    case "this quarter":
    case "qtd":
      return mk(new Date(Date.UTC(y, q * 3, 1)), tomorrow);
    case "last quarter":
      return mk(new Date(Date.UTC(y, q * 3 - 3, 1)), new Date(Date.UTC(y, q * 3, 1)));
    case "this year":
    case "ytd":
      return mk(new Date(Date.UTC(y, 0, 1)), tomorrow);
    case "last year":
      return mk(new Date(Date.UTC(y - 1, 0, 1)), new Date(Date.UTC(y, 0, 1)));
    case "all":
    case "all time":
      return mk(new Date(Date.UTC(2010, 0, 1)), tomorrow);
  }
  throw new ToolError(
    `Could not understand the period "${input}". Try "last 30 days", "last quarter", "2026-Q3", "2026-07" or "2026-07-01..2026-09-30".`,
  );
}

/** The window of equal length immediately before `p` (for period-over-period comparison). */
export function previousPeriod(p: Period): Period {
  const len = p.to.getTime() - p.from.getTime();
  const from = new Date(p.from.getTime() - len);
  return { from, to: p.from, label: `previous period (${iso(from)} to ${iso(addDays(p.from, -1))})` };
}

export const inPeriod = (value: string | null | undefined, p: Period) => {
  if (!value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= p.from.getTime() && t < p.to.getTime();
};

export const daysBetween = (a: string | Date, b: string | Date) =>
  (new Date(b).getTime() - new Date(a).getTime()) / DAY;
