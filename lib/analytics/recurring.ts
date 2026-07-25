import {
  addCalendarMonths,
  addDays,
  daysBetween,
  todayISO,
  type ISODate,
} from "@/lib/format/date";
import type { Transaction } from "@/lib/db/types";
import { mean, median, standardDeviation } from "./aggregate";

export interface RecurringPayment {
  merchant: string;
  description: string;
  category: string;
  /** Typical amount, as a positive number. */
  amount: number;
  /** Median gap between occurrences, in days. */
  intervalDays: number;
  occurrences: number;
  lastDate: ISODate;
  nextExpected: ISODate;
  /** Set when the most recent amount is meaningfully above the earlier norm. */
  increasedBy?: number;
}

const MIN_OCCURRENCES = 3;
/** Anything from a fortnightly gym fee to a yearly insurance renewal. */
const MIN_INTERVAL = 12;
const MAX_INTERVAL = 400;

/**
 * Finds payments that repeat on a schedule.
 *
 * Requires at least three occurrences and a *consistent* gap between them —
 * three unrelated Amazon orders are not a subscription. Consistency is measured
 * as the spread of the gaps relative to their median, so a monthly bill that
 * lands on the 3rd, the 5th and the 2nd still counts, while random purchases do
 * not.
 */
export function detectRecurring(transactions: Transaction[]): RecurringPayment[] {
  const byMerchant = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (tx.category === "Transfer") continue;
    const bucket = byMerchant.get(tx.merchant);
    if (bucket) bucket.push(tx);
    else byMerchant.set(tx.merchant, [tx]);
  }

  const results: RecurringPayment[] = [];

  for (const [merchant, rows] of byMerchant) {
    if (rows.length < MIN_OCCURRENCES) continue;

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    const intervalDays = median(gaps);
    if (intervalDays < MIN_INTERVAL || intervalDays > MAX_INTERVAL) continue;

    // Gaps must cluster. A coefficient of variation above 0.35 is noise, not a
    // schedule.
    const spread = standardDeviation(gaps) / intervalDays;
    if (spread > 0.35) continue;

    const amounts = sorted.map((t) => Math.abs(t.amount));

    // Amounts must be broadly stable too — a merchant billed monthly for wildly
    // different sums is a habit, not a subscription.
    const amountSpread = standardDeviation(amounts) / (mean(amounts) || 1);
    if (amountSpread > 0.4) continue;

    const last = sorted[sorted.length - 1];
    const typical = median(amounts);

    // Compare the latest charge against the earlier ones to spot a price rise.
    const earlier = amounts.slice(0, -1);
    const latest = amounts[amounts.length - 1];
    const earlierTypical = median(earlier);
    const increasedBy =
      earlierTypical > 0 && latest > earlierTypical * 1.1
        ? latest - earlierTypical
        : undefined;

    results.push({
      merchant,
      description: last.description,
      category: last.category,
      amount: typical,
      intervalDays: Math.round(intervalDays),
      occurrences: sorted.length,
      lastDate: last.date,
      nextExpected: projectNext(last.date, intervalDays),
      increasedBy,
    });
  }

  return results.sort((a, b) => b.amount - a.amount);
}

/**
 * Projects the next occurrence.
 *
 * Bills are charged on a date, not every N days. A subscription billed on the
 * 5th has gaps of 28, 30 and 31 days depending on the month; adding the median
 * gap walks the prediction forward a day at a time until it is wrong. Anything
 * roughly monthly, quarterly or yearly is projected in calendar units instead,
 * which keeps the day of the month where the user actually sees it.
 */
function projectNext(from: ISODate, intervalDays: number): ISODate {
  if (intervalDays >= 26 && intervalDays <= 35) return addCalendarMonths(from, 1);
  if (intervalDays >= 85 && intervalDays <= 96) return addCalendarMonths(from, 3);
  if (intervalDays >= 175 && intervalDays <= 190) return addCalendarMonths(from, 6);
  if (intervalDays >= 355 && intervalDays <= 375) return addCalendarMonths(from, 12);
  return addDays(from, Math.round(intervalDays));
}

export function upcomingBills(
  recurring: RecurringPayment[],
  withinDays = 7,
  from: ISODate = todayISO(),
): RecurringPayment[] {
  return recurring
    .filter((r) => {
      const days = daysBetween(from, r.nextExpected);
      return days >= 0 && days <= withinDays;
    })
    .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected));
}

export interface Outlier {
  transaction: Transaction;
  category: string;
  /** How many standard deviations above the category's usual spend. */
  zScore: number;
  categoryTypical: number;
}

/**
 * Unusually large transactions, judged against their own category.
 *
 * A ₹8,000 flight is unremarkable; a ₹8,000 coffee is not. Comparing each
 * transaction to its category's own distribution is the only way to tell those
 * apart. Categories with fewer than five transactions are skipped — a standard
 * deviation over three points describes nothing.
 */
export function detectOutliers(transactions: Transaction[], threshold = 3): Outlier[] {
  const byCategory = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (tx.category === "Transfer") continue;
    const bucket = byCategory.get(tx.category);
    if (bucket) bucket.push(tx);
    else byCategory.set(tx.category, [tx]);
  }

  const outliers: Outlier[] = [];

  for (const [category, rows] of byCategory) {
    if (rows.length < 5) continue;

    const amounts = rows.map((t) => Math.abs(t.amount));
    const avg = mean(amounts);
    const sd = standardDeviation(amounts);
    if (sd === 0) continue;

    for (const tx of rows) {
      const amount = Math.abs(tx.amount);
      const zScore = (amount - avg) / sd;
      if (zScore >= threshold) {
        outliers.push({ transaction: tx, category, zScore, categoryTypical: median(amounts) });
      }
    }
  }

  return outliers.sort((a, b) => b.zScore - a.zScore);
}

export interface DuplicateSuspect {
  a: Transaction;
  b: Transaction;
}

/**
 * Same merchant, same amount, within a couple of days.
 *
 * Deliberately separate from import dedupe, which catches byte-identical
 * re-imports. This catches a genuine double charge — the same subscription
 * billed twice, a card retried — which is a real thing worth telling someone
 * about, and which import dedupe would only hide.
 */
export function detectDuplicates(
  transactions: Transaction[],
  windowDays = 2,
): DuplicateSuspect[] {
  const sorted = [...transactions]
    .filter((t) => t.amount < 0 && t.category !== "Transfer")
    .sort((a, b) => a.date.localeCompare(b.date));

  const suspects: DuplicateSuspect[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const gap = daysBetween(a.date, b.date);
      if (gap > windowDays) break;
      if (a.merchant !== b.merchant) continue;
      if (Math.abs(a.amount - b.amount) > 0.01) continue;
      suspects.push({ a, b });
    }
  }

  return suspects;
}
