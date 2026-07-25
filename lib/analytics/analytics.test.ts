import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/db/types";
import {
  balanceSeries,
  categoryTotals,
  categoryTrend,
  median,
  monthlyTotals,
  runwayMonths,
  snapshot,
  standardDeviation,
} from "./aggregate";
import {
  detectDuplicates,
  detectOutliers,
  detectRecurring,
  upcomingBills,
} from "./recurring";

let counter = 0;
function tx(overrides: Partial<Transaction> = {}): Transaction {
  const date = overrides.date ?? "2026-04-10";
  return {
    description: "x",
    merchant: "x",
    amount: -100,
    category: "Other",
    account: "HDFC",
    hash: `h${counter++}`,
    importId: "i",
    ...overrides,
    date,
    // Always derived from the final date, never overridable independently —
    // a month that disagrees with its date would silently corrupt aggregates.
    month: date.slice(0, 7),
  };
}

describe("monthlyTotals", () => {
  it("splits income, expense and investing", () => {
    const rows = monthlyTotals([
      tx({ date: "2026-04-01", amount: 120000, category: "Income" }),
      tx({ date: "2026-04-05", amount: -30000, category: "Rent" }),
      tx({ date: "2026-04-06", amount: -15000, category: "Investments" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].income).toBe(120000);
    expect(rows[0].expense).toBe(30000);
    // Investing is saving, not spending. Counting it as expense would
    // understate the savings rate by exactly the amount being saved.
    expect(rows[0].invested).toBe(15000);
    expect(rows[0].net).toBe(75000);
  });

  it("ignores transfers on both sides", () => {
    const rows = monthlyTotals([
      tx({ date: "2026-04-01", amount: 120000, category: "Income" }),
      tx({ date: "2026-04-02", amount: -50000, category: "Transfer" }),
      tx({ date: "2026-04-03", amount: 50000, category: "Transfer" }),
    ]);

    expect(rows[0].income).toBe(120000);
    expect(rows[0].expense).toBe(0);
  });

  it("fills empty months so a chart line does not jump the gap", () => {
    const rows = monthlyTotals([
      tx({ date: "2026-01-10", amount: -500 }),
      tx({ date: "2026-04-10", amount: -500 }),
    ]);

    expect(rows.map((r) => r.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(rows[1].expense).toBe(0);
  });
});

describe("categoryTotals", () => {
  const rows = categoryTotals([
    tx({ amount: -4000, category: "Rent" }),
    tx({ amount: -3000, category: "Groceries" }),
    tx({ amount: -2000, category: "Groceries" }),
    tx({ amount: 120000, category: "Income" }),
    tx({ amount: -10000, category: "Investments" }),
    tx({ amount: -1000, category: "Transfer" }),
  ]);

  it("ranks spending largest first", () => {
    expect(rows.map((r) => r.category)).toEqual(["Groceries", "Rent"]);
    expect(rows[0].amount).toBe(5000);
    expect(rows[0].count).toBe(2);
  });

  it("excludes income, investments and transfers", () => {
    expect(rows.find((r) => r.category === "Income")).toBeUndefined();
    expect(rows.find((r) => r.category === "Investments")).toBeUndefined();
    expect(rows.find((r) => r.category === "Transfer")).toBeUndefined();
  });

  it("computes shares that sum to one", () => {
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1);
  });
});

describe("categoryTrend", () => {
  it("caps series at the palette's limit and buckets the rest", () => {
    // The categorical palette has eight slots and never cycles hues, so a ninth
    // series would have to reuse a colour.
    const many = Array.from({ length: 12 }, (_, i) =>
      tx({ amount: -(1000 - i * 10), category: `Cat${i}` }),
    );
    const { categories } = categoryTrend(many, 7);

    expect(categories).toHaveLength(8);
    expect(categories[7]).toBe("Other categories");
  });

  it("does not add an Other bucket when everything fits", () => {
    const { categories } = categoryTrend(
      [tx({ amount: -100, category: "Rent" }), tx({ amount: -50, category: "Fuel" })],
      7,
    );
    expect(categories).toEqual(["Rent", "Fuel"]);
  });
});

describe("balanceSeries", () => {
  it("prefers the statement's own balance column", () => {
    const result = balanceSeries([
      tx({ date: "2026-04-01", amount: -100, balance: 9900 }),
      tx({ date: "2026-04-02", amount: -100, balance: 9800 }),
    ]);

    expect(result.fromStatement).toBe(true);
    expect(result.points.at(-1)?.balance).toBe(9800);
  });

  it("falls back to a cumulative sum and says so", () => {
    const result = balanceSeries([
      tx({ date: "2026-04-01", amount: -100 }),
      tx({ date: "2026-04-02", amount: -250 }),
    ]);

    expect(result.fromStatement).toBe(false);
    expect(result.points.at(-1)?.balance).toBe(-350);
  });
});

describe("median and standardDeviation", () => {
  it("takes the middle value, and the midpoint of an even set", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("is not dragged by a single outlier the way a mean is", () => {
    // One wedding should not reset the food budget.
    expect(median([100, 110, 105, 100000])).toBe(107.5);
  });

  it("returns zero standard deviation for fewer than two points", () => {
    expect(standardDeviation([5])).toBe(0);
  });
});

describe("snapshot", () => {
  const transactions = [
    // Three complete months plus a partial current month.
    ...["2026-01", "2026-02", "2026-03"].flatMap((month) => [
      tx({ date: `${month}-01`, amount: 100000, category: "Income" }),
      tx({ date: `${month}-05`, amount: -60000, category: "Rent" }),
      tx({ date: `${month}-06`, amount: -10000, category: "Investments" }),
    ]),
    tx({ date: "2026-04-02", amount: 100000, category: "Income" }),
    tx({ date: "2026-04-03", amount: -3000, category: "Dining" }),
  ];

  const result = snapshot(transactions, 6);

  it("excludes the partial current month from the medians", () => {
    // Including a month that is three days old makes every budget look
    // generous on the 3rd and impossible on the 28th.
    expect(result.medianMonthlyExpense).toBe(60000);
    expect(result.medianMonthlyIncome).toBe(100000);
  });

  it("computes surplus and savings rate", () => {
    expect(result.monthlySurplus).toBe(40000);
    expect(result.savingsRate).toBeCloseTo(0.4);
  });

  it("still reports the partial month in the series", () => {
    expect(result.latestMonth).toBe("2026-04");
    expect(result.months).toHaveLength(4);
  });

  it("handles having no data at all", () => {
    const empty = snapshot([]);
    expect(empty.savingsRate).toBe(0);
    expect(empty.latestMonth).toBeNull();
  });
});

describe("runwayMonths", () => {
  it("divides savings by monthly spend", () => {
    expect(runwayMonths(300000, 50000)).toBe(6);
  });

  it("returns Infinity when there is no spending to run out against", () => {
    // Callers must render this as "not enough data", never "Infinity months".
    expect(runwayMonths(300000, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("detectRecurring", () => {
  it("finds a monthly subscription", () => {
    const netflix = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((date) =>
      tx({ date, amount: -649, merchant: "netflix", category: "Subscriptions" }),
    );

    const [found] = detectRecurring(netflix);

    expect(found.merchant).toBe("netflix");
    expect(found.amount).toBe(649);
    expect(found.occurrences).toBe(4);
    expect(found.intervalDays).toBeGreaterThanOrEqual(28);
    // Projected in calendar months, not by adding the median gap in days —
    // a bill charged on the 5th stays on the 5th.
    expect(found.nextExpected).toBe("2026-05-05");
  });

  it("tolerates a few days of drift in the billing date", () => {
    const rent = ["2026-01-03", "2026-02-05", "2026-03-02", "2026-04-04"].map((date) =>
      tx({ date, amount: -30000, merchant: "landlord", category: "Rent" }),
    );
    expect(detectRecurring(rent)).toHaveLength(1);
  });

  it("does not call three unrelated purchases a subscription", () => {
    const amazon = ["2026-01-05", "2026-01-19", "2026-03-27"].map((date) =>
      tx({ date, amount: -2400, merchant: "amazon", category: "Shopping" }),
    );
    expect(detectRecurring(amazon)).toHaveLength(0);
  });

  it("ignores a merchant billed monthly for wildly different sums", () => {
    const rows = [
      tx({ date: "2026-01-05", amount: -500, merchant: "shop" }),
      tx({ date: "2026-02-05", amount: -9000, merchant: "shop" }),
      tx({ date: "2026-03-05", amount: -200, merchant: "shop" }),
    ];
    expect(detectRecurring(rows)).toHaveLength(0);
  });

  it("flags a price increase on the latest charge", () => {
    const rows = [
      tx({ date: "2026-01-05", amount: -649, merchant: "netflix" }),
      tx({ date: "2026-02-05", amount: -649, merchant: "netflix" }),
      tx({ date: "2026-03-05", amount: -649, merchant: "netflix" }),
      tx({ date: "2026-04-05", amount: -799, merchant: "netflix" }),
    ];

    const [found] = detectRecurring(rows);
    expect(found.increasedBy).toBe(150);
  });

  it("needs at least three occurrences", () => {
    const rows = [
      tx({ date: "2026-03-05", amount: -649, merchant: "netflix" }),
      tx({ date: "2026-04-05", amount: -649, merchant: "netflix" }),
    ];
    expect(detectRecurring(rows)).toHaveLength(0);
  });
});

describe("upcomingBills", () => {
  it("returns only bills due inside the window", () => {
    const recurring = detectRecurring(
      ["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20"].map((date) =>
        tx({ date, amount: -1200, merchant: "gym" }),
      ),
    );

    expect(upcomingBills(recurring, 7, "2026-05-15")).toHaveLength(1);
    expect(upcomingBills(recurring, 7, "2026-05-01")).toHaveLength(0);
    // Already past.
    expect(upcomingBills(recurring, 7, "2026-05-25")).toHaveLength(0);
  });
});

describe("detectOutliers", () => {
  it("judges a transaction against its own category", () => {
    // A large flight is unremarkable; a large coffee is not.
    const dining = [
      ...Array.from({ length: 8 }, () => tx({ amount: -300, category: "Dining" })),
      tx({ amount: -8000, category: "Dining", description: "Big dinner" }),
    ];

    const [outlier] = detectOutliers(dining, 2);
    expect(outlier.transaction.description).toBe("Big dinner");
    expect(outlier.category).toBe("Dining");
  });

  it("skips categories with too few transactions to describe", () => {
    const sparse = [
      tx({ amount: -100, category: "Rare" }),
      tx({ amount: -50000, category: "Rare" }),
    ];
    expect(detectOutliers(sparse)).toHaveLength(0);
  });
});

describe("detectDuplicates", () => {
  it("flags the same charge twice within the window", () => {
    const rows = [
      tx({ date: "2026-04-10", amount: -1499, merchant: "gym" }),
      tx({ date: "2026-04-11", amount: -1499, merchant: "gym" }),
    ];
    expect(detectDuplicates(rows)).toHaveLength(1);
  });

  it("does not flag the same amount at a different merchant", () => {
    const rows = [
      tx({ date: "2026-04-10", amount: -1499, merchant: "gym" }),
      tx({ date: "2026-04-10", amount: -1499, merchant: "spa" }),
    ];
    expect(detectDuplicates(rows)).toHaveLength(0);
  });

  it("does not flag charges outside the window", () => {
    const rows = [
      tx({ date: "2026-04-10", amount: -1499, merchant: "gym" }),
      tx({ date: "2026-04-20", amount: -1499, merchant: "gym" }),
    ];
    expect(detectDuplicates(rows)).toHaveLength(0);
  });
});
