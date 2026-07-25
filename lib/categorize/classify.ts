import {
  CATEGORIES,
  CATEGORY_RULES,
  UNCATEGORIZED,
  type Category,
} from "./categories";
import { matchesKeyword } from "./keywords";

export interface ClassifyContext {
  /** merchant -> category, from corrections the user has already made. */
  overrides?: Map<string, string>;
  /** A Category column the source sheet supplied, if any. */
  sheetCategory?: string;
}

const CANONICAL = new Map<string, Category>(
  CATEGORIES.map((c) => [c.toLowerCase(), c]),
);

/** Maps a free-text category from a sheet onto the seeded set when it matches. */
export function canonicalCategory(value: string | undefined): Category | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return null;

  const exact = CANONICAL.get(cleaned);
  if (exact) return exact;

  // Common aliases people use in their own sheets.
  const aliases: Record<string, Category> = {
    food: "Dining",
    "eating out": "Dining",
    restaurants: "Dining",
    travel: "Transport",
    commute: "Transport",
    "petrol/diesel": "Fuel",
    bills: "Utilities",
    telecom: "Mobile & Internet",
    internet: "Mobile & Internet",
    phone: "Mobile & Internet",
    medical: "Health",
    healthcare: "Health",
    fitness: "Health",
    loan: "EMI",
    "loan emi": "EMI",
    investment: "Investments",
    savings: "Investments",
    salary: "Income",
    entertainment: "Entertainment",
    misc: "Other",
    miscellaneous: "Other",
    uncategorized: "Other",
    uncategorised: "Other",
  };

  return aliases[cleaned] ?? null;
}

/**
 * Assigns a category to a transaction.
 *
 * Precedence, highest first:
 *   1. a correction the user made for this merchant
 *   2. a category the source sheet already carried
 *   3. keyword rules
 *   4. sign — a positive amount with no other signal is income, not "Other"
 *
 * The user's own correction outranking everything is the point: a classifier
 * that keeps re-deciding what the user already fixed is worse than no
 * classifier at all.
 */
export function classify(
  merchant: string,
  amount: number,
  context: ClassifyContext = {},
): string {
  const override = context.overrides?.get(merchant);
  if (override) return override;

  const fromSheet = canonicalCategory(context.sheetCategory);
  if (fromSheet) return fromSheet;

  const haystack = ` ${merchant} `;
  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (!matchesKeyword(haystack, keyword)) continue;
      // An income keyword on a debit is a false positive — "salary account
      // maintenance" is a fee, not pay. Fall through and keep looking.
      if (rule.category === "Income" && amount < 0) continue;
      return rule.category;
    }
  }

  if (amount > 0) return "Income";
  return UNCATEGORIZED;
}

/** Builds the override lookup the classifier expects from stored corrections. */
export function overridesToMap(
  rows: Array<{ merchant: string; category: string }>,
): Map<string, string> {
  return new Map(rows.map((r) => [r.merchant, r.category]));
}
