import { NON_EXPENSE_CATEGORIES } from "@/lib/categorize/categories";
import {
  addMonths,
  monthRange,
  monthsBetween,
  type MonthKey,
} from "@/lib/format/date";
import type { Transaction } from "@/lib/db/types";

export interface MonthlyTotals {
  month: MonthKey;
  income: number;
  /** Positive number. Excludes transfers and investments — see below. */
  expense: number;
  /** Money moved into investments. Saving, not spending. */
  invested: number;
  net: number;
}

export interface CategoryTotal {
  category: string;
  amount: number;
  share: number;
  count: number;
}

/**
 * Sums transactions by month.
 *
 * Transfers are excluded from both sides — they are the user's own money
 * changing pockets. Investments are pulled out separately rather than counted as
 * spending: money moved into a SIP has left the current account but has not been
 * consumed, and folding it into expenses would understate the savings rate by
 * exactly the amount being saved.
 */
export function monthlyTotals(transactions: Transaction[]): MonthlyTotals[] {
  const byMonth = new Map<MonthKey, MonthlyTotals>();

  for (const tx of transactions) {
    if (tx.category === "Transfer") continue;

    let row = byMonth.get(tx.month);
    if (!row) {
      row = { month: tx.month, income: 0, expense: 0, invested: 0, net: 0 };
      byMonth.set(tx.month, row);
    }

    if (tx.category === "Investments") {
      row.invested += Math.abs(tx.amount);
    } else if (tx.amount > 0) {
      row.income += tx.amount;
    } else {
      row.expense += -tx.amount;
    }
  }

  for (const row of byMonth.values()) {
    row.net = row.income - row.expense - row.invested;
  }

  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  // Fill gaps so a month with no transactions is a zero on the chart rather than
  // a missing point the line silently draws straight through.
  if (rows.length < 2) return rows;
  const filled: MonthlyTotals[] = [];
  for (const month of monthRange(rows[0].month, rows[rows.length - 1].month)) {
    filled.push(
      byMonth.get(month) ?? { month, income: 0, expense: 0, invested: 0, net: 0 },
    );
  }
  return filled;
}

/** Spending by category over a set of transactions, largest first. */
export function categoryTotals(transactions: Transaction[]): CategoryTotal[] {
  const byCategory = new Map<string, { amount: number; count: number }>();

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (NON_EXPENSE_CATEGORIES.has(tx.category)) continue;

    const row = byCategory.get(tx.category) ?? { amount: 0, count: 0 };
    row.amount += -tx.amount;
    row.count += 1;
    byCategory.set(tx.category, row);
  }

  const total = [...byCategory.values()].reduce((sum, r) => sum + r.amount, 0);

  return [...byCategory.entries()]
    .map(([category, row]) => ({
      category,
      amount: row.amount,
      count: row.count,
      share: total === 0 ? 0 : row.amount / total,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface CategoryTrendPoint {
  month: MonthKey;
  [category: string]: number | string;
}

/**
 * Category spend per month, capped at `topN` series plus an "Other" bucket.
 *
 * The cap is not cosmetic. The categorical palette has eight slots and hues are
 * never cycled, so a ninth series would have to reuse a colour and two different
 * categories would render identically.
 */
export function categoryTrend(
  transactions: Transaction[],
  topN = 7,
): { points: CategoryTrendPoint[]; categories: string[] } {
  const ranked = categoryTotals(transactions);
  const top = ranked.slice(0, topN).map((r) => r.category);
  const hasOther = ranked.length > topN;
  const categories = hasOther ? [...top, "Other categories"] : top;

  const byMonth = new Map<MonthKey, CategoryTrendPoint>();

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (NON_EXPENSE_CATEGORIES.has(tx.category)) continue;

    let point = byMonth.get(tx.month);
    if (!point) {
      point = { month: tx.month };
      for (const category of categories) point[category] = 0;
      byMonth.set(tx.month, point);
    }

    const bucket = top.includes(tx.category) ? tx.category : "Other categories";
    if (categories.includes(bucket)) {
      point[bucket] = (point[bucket] as number) + -tx.amount;
    }
  }

  const points = [...byMonth.values()].sort((a, b) =>
    String(a.month).localeCompare(String(b.month)),
  );

  return { points, categories };
}

export interface BalancePoint {
  date: string;
  balance: number;
}

/**
 * Running balance over time.
 *
 * Prefers the balance column the statement supplied — that is the bank's own
 * figure and accounts for anything Ledgr never saw. Falls back to a cumulative
 * sum of amounts, which is only correct in shape, not in level, so callers
 * label it as such.
 */
export function balanceSeries(transactions: Transaction[]): {
  points: BalancePoint[];
  fromStatement: boolean;
} {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const withBalance = sorted.filter((t) => typeof t.balance === "number");

  if (withBalance.length >= sorted.length * 0.8 && withBalance.length > 0) {
    const byDate = new Map<string, number>();
    // Last row of each day wins — that is the day's closing balance.
    for (const tx of withBalance) byDate.set(tx.date, tx.balance as number);
    return {
      points: [...byDate.entries()].map(([date, balance]) => ({ date, balance })),
      fromStatement: true,
    };
  }

  let running = 0;
  const byDate = new Map<string, number>();
  for (const tx of sorted) {
    running += tx.amount;
    byDate.set(tx.date, running);
  }

  return {
    points: [...byDate.entries()].map(([date, balance]) => ({ date, balance })),
    fromStatement: false,
  };
}

/**
 * Median rather than mean, throughout.
 *
 * One wedding, one flight, or one insurance renewal will drag a mean upward and
 * keep it there. A median monthly spend describes the month the user actually
 * has most of the time, which is what a budget envelope needs to be built from.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export interface FinancialSnapshot {
  months: MonthlyTotals[];
  latestMonth: MonthKey | null;
  medianMonthlyIncome: number;
  medianMonthlyExpense: number;
  medianMonthlyInvested: number;
  /** Income minus expenses, before investing. What is available to allocate. */
  monthlySurplus: number;
  savingsRate: number;
  totalIncome: number;
  totalExpense: number;
}

/**
 * The trailing view every other engine is built on.
 *
 * `lookbackMonths` deliberately excludes the current month: it is partial, so
 * including it drags the median down and makes every budget look generous on
 * the 3rd and impossible on the 28th.
 */
export function snapshot(
  transactions: Transaction[],
  lookbackMonths = 6,
  currentMonth?: MonthKey,
): FinancialSnapshot {
  const all = monthlyTotals(transactions);

  if (all.length === 0) {
    return {
      months: [],
      latestMonth: null,
      medianMonthlyIncome: 0,
      medianMonthlyExpense: 0,
      medianMonthlyInvested: 0,
      monthlySurplus: 0,
      savingsRate: 0,
      totalIncome: 0,
      totalExpense: 0,
    };
  }

  const latestMonth = all[all.length - 1].month;
  const excludeMonth = currentMonth ?? latestMonth;
  const complete = all.filter((m) => m.month !== excludeMonth);
  const basis = complete.length > 0 ? complete : all;

  const earliest = addMonths(basis[basis.length - 1].month, -(lookbackMonths - 1));
  const window = basis.filter((m) => monthsBetween(earliest, m.month) >= 0);

  const medianMonthlyIncome = median(window.map((m) => m.income));
  const medianMonthlyExpense = median(window.map((m) => m.expense));
  const medianMonthlyInvested = median(window.map((m) => m.invested));
  const monthlySurplus = medianMonthlyIncome - medianMonthlyExpense;

  return {
    months: all,
    latestMonth,
    medianMonthlyIncome,
    medianMonthlyExpense,
    medianMonthlyInvested,
    monthlySurplus,
    // Investing counts as saving, so it belongs in the numerator.
    savingsRate:
      medianMonthlyIncome === 0
        ? 0
        : (medianMonthlyIncome - medianMonthlyExpense) / medianMonthlyIncome,
    totalIncome: all.reduce((sum, m) => sum + m.income, 0),
    totalExpense: all.reduce((sum, m) => sum + m.expense, 0),
  };
}

/**
 * Months of expenses the user's liquid savings would cover.
 *
 * Returns Infinity when there is no expense history, and callers must handle
 * that rather than rendering "Infinity months" — see the runway stat tile.
 */
export function runwayMonths(liquidSavings: number, monthlyExpense: number): number {
  if (monthlyExpense <= 0) return Number.POSITIVE_INFINITY;
  return liquidSavings / monthlyExpense;
}
