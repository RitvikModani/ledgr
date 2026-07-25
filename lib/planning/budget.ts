import { NON_BUDGETABLE } from "@/lib/categorize/categories";
import { median } from "@/lib/analytics/aggregate";
import { addMonths, monthsBetween, type MonthKey } from "@/lib/format/date";
import type { Transaction } from "@/lib/db/types";

export interface Envelope {
  category: string;
  /** The suggested monthly limit. */
  monthlyLimit: number;
  /** What the user typically spends. */
  typical: number;
  /** How much of the limit is a deliberate trim rather than the observed median. */
  trimmed: number;
  monthsObserved: number;
  /** True when there is too little history for the number to mean much. */
  thin: boolean;
}

export interface AutoBudget {
  envelopes: Envelope[];
  totalLimit: number;
  totalTypical: number;
  monthsObserved: number;
}

/**
 * Derives spending envelopes from the user's own history.
 *
 * Built on medians, not means. One wedding, one flight or one annual insurance
 * renewal will drag a mean upward and hold it there, producing a "budget" that
 * is really a description of the user's worst month.
 *
 * `trimPercent` shaves a little off the median for discretionary categories
 * only. Trimming rent or EMI would be meaningless — those are contracts, not
 * choices — so essentials are budgeted at exactly what they cost.
 */
const ESSENTIALS = new Set([
  "Rent",
  "Utilities",
  "Mobile & Internet",
  "Insurance",
  "Health",
  "Education",
]);

export function autoBudget(
  transactions: Transaction[],
  options: { lookbackMonths?: number; trimPercent?: number; currentMonth?: MonthKey } = {},
): AutoBudget {
  const { lookbackMonths = 6, trimPercent = 0.05, currentMonth } = options;

  // Per category, per month, so a category's median is over months rather than
  // over transactions — otherwise a category with many small charges looks
  // cheaper per month than it is.
  const byCategory = new Map<string, Map<MonthKey, number>>();
  const monthsSeen = new Set<MonthKey>();

  for (const tx of transactions) {
    if (tx.amount >= 0) continue;
    if (NON_BUDGETABLE.has(tx.category)) continue;
    monthsSeen.add(tx.month);

    let months = byCategory.get(tx.category);
    if (!months) {
      months = new Map();
      byCategory.set(tx.category, months);
    }
    months.set(tx.month, (months.get(tx.month) ?? 0) + -tx.amount);
  }

  const sortedMonths = [...monthsSeen].sort();
  if (sortedMonths.length === 0) {
    return { envelopes: [], totalLimit: 0, totalTypical: 0, monthsObserved: 0 };
  }

  const lastComplete =
    currentMonth && sortedMonths.at(-1) === currentMonth
      ? sortedMonths.at(-2)
      : sortedMonths.at(-1);

  if (!lastComplete) {
    return { envelopes: [], totalLimit: 0, totalTypical: 0, monthsObserved: 0 };
  }

  const earliest = addMonths(lastComplete, -(lookbackMonths - 1));
  const window = sortedMonths.filter(
    (m) => monthsBetween(earliest, m) >= 0 && monthsBetween(m, lastComplete) >= 0,
  );

  const envelopes: Envelope[] = [];

  for (const [category, months] of byCategory) {
    // Months with no spend in this category count as zero, not as missing —
    // otherwise a category bought once a quarter looks like a monthly expense.
    const values = window.map((month) => months.get(month) ?? 0);
    const observed = values.filter((v) => v > 0).length;
    if (observed === 0) continue;

    const typical = median(values);
    if (typical <= 0) continue;

    const trimRate = ESSENTIALS.has(category) ? 0 : trimPercent;
    const monthlyLimit = Math.round(typical * (1 - trimRate));

    envelopes.push({
      category,
      monthlyLimit,
      typical,
      trimmed: typical - monthlyLimit,
      monthsObserved: observed,
      // Two months of history is a guess dressed as a budget.
      thin: window.length < 3 || observed < 2,
    });
  }

  envelopes.sort((a, b) => b.monthlyLimit - a.monthlyLimit);

  return {
    envelopes,
    totalLimit: envelopes.reduce((sum, e) => sum + e.monthlyLimit, 0),
    totalTypical: envelopes.reduce((sum, e) => sum + e.typical, 0),
    monthsObserved: window.length,
  };
}

export interface CategorySpend {
  category: string;
  spent: number;
  limit: number;
  ratio: number;
}

/** Spend against each envelope for one month. */
export function spendAgainstBudget(
  transactions: Transaction[],
  budgets: Array<{ category: string; monthlyLimit: number }>,
  month: MonthKey,
): CategorySpend[] {
  const spent = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.month !== month) continue;
    if (tx.amount >= 0) continue;
    if (NON_BUDGETABLE.has(tx.category)) continue;
    spent.set(tx.category, (spent.get(tx.category) ?? 0) + -tx.amount);
  }

  return budgets
    .map((budget) => {
      const amount = spent.get(budget.category) ?? 0;
      return {
        category: budget.category,
        spent: amount,
        limit: budget.monthlyLimit,
        ratio: budget.monthlyLimit === 0 ? 0 : amount / budget.monthlyLimit,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
