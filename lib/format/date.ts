/**
 * Dates in Ledgr are stored as plain `YYYY-MM-DD` strings, never as timestamps.
 *
 * A transaction happened on a calendar day, not at an instant. Storing epoch
 * millis means a statement imported in IST and read in UTC slides a day
 * backwards and lands in the wrong month — which silently corrupts every
 * monthly aggregate downstream. Strings avoid the whole class of bug.
 */
export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is ISODate {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local-calendar ISO date. Deliberately not toISOString(), which is UTC. */
export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses to local midnight, so no timezone can shift the calendar day. */
export function parseISODate(value: ISODate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function monthKeyOf(value: ISODate): MonthKey {
  return value.slice(0, 7);
}

export function monthKeyOfDate(date: Date): MonthKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-04" -> "Apr 2026"; with short=true -> "Apr '26" for cramped axes. */
export function formatMonthKey(key: MonthKey, short = false): string {
  const [y, m] = key.split("-").map(Number);
  const name = MONTH_NAMES[m - 1] ?? "?";
  return short ? `${name} '${String(y).slice(2)}` : `${name} ${y}`;
}

export function formatDate(value: ISODate): string {
  const [y, m, d] = value.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function addMonths(key: MonthKey, count: number): MonthKey {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + count;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function addDays(value: ISODate, count: number): ISODate {
  const date = parseISODate(value);
  date.setDate(date.getDate() + count);
  return toISODate(date);
}

export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = parseISODate(to).getTime() - parseISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Inclusive list of month keys from `from` to `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const span = monthsBetween(from, to);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => addMonths(from, i));
}

export function daysInMonth(key: MonthKey): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/* --------------------------------------------------------------------------
   Indian fiscal year: 1 April to 31 March.

   FY 2026-27 starts April 2026. A transaction dated March 2026 belongs to
   FY 2025-26, which is why every fiscal helper subtracts a year for Jan-Mar.
-------------------------------------------------------------------------- */

export const FISCAL_YEAR_START_MONTH = 4;

export function fiscalYearOf(value: ISODate): number {
  const [y, m] = value.split("-").map(Number);
  return m >= FISCAL_YEAR_START_MONTH ? y : y - 1;
}

export function fiscalYearLabel(fy: number): string {
  return `FY ${fy}–${String(fy + 1).slice(2)}`;
}

export function fiscalYearRange(fy: number): { start: ISODate; end: ISODate } {
  return { start: `${fy}-04-01`, end: `${fy + 1}-03-31` };
}

/** Months of a fiscal year in fiscal order — Apr first, Mar last. */
export function fiscalYearMonths(fy: number): MonthKey[] {
  return monthRange(`${fy}-04`, `${fy + 1}-03`);
}

/**
 * How far through the current month we are, as a fraction.
 *
 * Month-to-date pace alerts divide by this to project a full-month spend, so
 * it is clamped away from zero — on the 1st of the month a naive division
 * would project an infinite overspend and fire every alert at once.
 */
export function monthProgress(value: ISODate = todayISO()): number {
  const [, , d] = value.split("-").map(Number);
  const total = daysInMonth(monthKeyOf(value));
  return Math.min(1, Math.max(1 / total, d / total));
}

export function relativeDayLabel(value: ISODate, from: ISODate = todayISO()): string {
  const diff = daysBetween(from, value);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 0) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}
