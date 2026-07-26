import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW, type Budget, type Goal, type Transaction } from "@/lib/db/types";
import { snapshot } from "@/lib/analytics/aggregate";
import { evaluateRules, type RuleContext } from "./rules";

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
    month: date.slice(0, 7),
  };
}

function context(partial: Partial<RuleContext> = {}): RuleContext {
  const transactions = partial.transactions ?? [];
  return {
    transactions,
    budgets: [],
    goals: [],
    interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true },
    stats: partial.stats ?? snapshot(transactions),
    allocationRows: [],
    bufferMonths: 6,
    today: "2026-04-20",
    currentMonth: "2026-04",
    ...partial,
  };
}

function kinds(alerts: ReturnType<typeof evaluateRules>) {
  return alerts.map((a) => a.kind);
}

/* -------------------------------------------------------------------------- */

describe("budget rules", () => {
  const budgets: Budget[] = [
    { category: "Dining", monthlyLimit: 10000, auto: true, updatedAt: 0 },
  ];

  it("stays quiet below 85% of the envelope", () => {
    const alerts = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -8400, category: "Dining" })],
      }),
    );
    expect(kinds(alerts)).not.toContain("budget-exceeded");
  });

  it("warns at 85%", () => {
    const alerts = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -8500, category: "Dining" })],
      }),
    );
    const alert = alerts.find((a) => a.kind === "budget-exceeded");
    expect(alert?.severity).toBe("warning");
  });

  it("escalates to serious at the limit and critical at 125%", () => {
    const atLimit = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -10000, category: "Dining" })],
      }),
    );
    expect(atLimit.find((a) => a.kind === "budget-exceeded")?.severity).toBe("serious");

    const wayOver = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -12500, category: "Dining" })],
      }),
    );
    expect(wayOver.find((a) => a.kind === "budget-exceeded")?.severity).toBe("critical");
  });

  it("projects an overspend from the month's pace", () => {
    // 6,000 spent by the 20th projects to about 9,000 — under the limit, so no
    // pace alert. 7,000 projects to 10,500, which is over.
    const safe = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -6000, category: "Dining" })],
      }),
    );
    expect(kinds(safe)).not.toContain("budget-pace");

    const pacey = evaluateRules(
      context({
        budgets,
        transactions: [tx({ date: "2026-04-05", amount: -7500, category: "Dining" })],
      }),
    );
    expect(kinds(pacey)).toContain("budget-pace");
  });

  it("does not project from the first days of the month", () => {
    // An alert that cries wolf every month on the 2nd is one users learn to
    // ignore, which costs them the alerts that matter.
    const alerts = evaluateRules(
      context({
        budgets,
        today: "2026-04-02",
        transactions: [tx({ date: "2026-04-01", amount: -2000, category: "Dining" })],
      }),
    );
    expect(kinds(alerts)).not.toContain("budget-pace");
  });
});

describe("runway and buffer rules", () => {
  const spending = ["2026-01", "2026-02", "2026-03"].map((month) =>
    tx({ date: `${month}-05`, amount: -50000, category: "Rent" }),
  );

  it("goes critical under a month of expenses", () => {
    const alerts = evaluateRules(
      context({
        transactions: spending,
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 30000 },
      }),
    );
    expect(alerts.find((a) => a.kind === "low-runway")?.severity).toBe("critical");
  });

  it("is serious between one and three months", () => {
    const alerts = evaluateRules(
      context({
        transactions: spending,
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 100000 },
      }),
    );
    expect(alerts.find((a) => a.kind === "low-runway")?.severity).toBe("serious");
  });

  it("says nothing past three months", () => {
    const alerts = evaluateRules(
      context({
        transactions: spending,
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 400000 },
      }),
    );
    expect(kinds(alerts)).not.toContain("low-runway");
  });

  it("does not nag when the buffer is nearly there", () => {
    const alerts = evaluateRules(
      context({
        transactions: spending,
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 290000 },
      }),
    );
    expect(kinds(alerts)).not.toContain("emergency-fund-gap");
  });
});

describe("protection and debt rules", () => {
  it("raises a critical alert for no health cover", () => {
    const alerts = evaluateRules(
      context({ interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: false } }),
    );
    const alert = alerts.find((a) => a.dedupeKey === "underinsured:health");
    expect(alert?.severity).toBe("critical");
  });

  it("only asks for term cover when someone depends on the income", () => {
    const alone = evaluateRules(
      context({
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, dependents: 0 },
      }),
    );
    expect(alone.find((a) => a.dedupeKey === "underinsured:term")).toBeUndefined();

    const withFamily = evaluateRules(
      context({
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, dependents: 2 },
      }),
    );
    expect(withFamily.find((a) => a.dedupeKey === "underinsured:term")).toBeDefined();
  });

  it("flags expensive debt and ignores cheap debt", () => {
    const expensive = evaluateRules(
      context({
        interview: {
          ...DEFAULT_INTERVIEW,
          hasHealthInsurance: true,
          totalDebt: 300000,
          highestDebtRate: 0.36,
        },
      }),
    );
    expect(expensive.find((a) => a.kind === "high-interest-debt")?.severity).toBe("critical");

    const cheap = evaluateRules(
      context({
        interview: {
          ...DEFAULT_INTERVIEW,
          hasHealthInsurance: true,
          totalDebt: 3000000,
          highestDebtRate: 0.085,
        },
      }),
    );
    expect(kinds(cheap)).not.toContain("high-interest-debt");
  });
});

describe("goal rules", () => {
  const goal: Goal = {
    name: "House",
    kind: "home",
    targetAmount: 2000000,
    currentAmount: 0,
    targetDate: "2031-04-01",
    priority: "high",
    expectedAnnualReturn: 0.1,
    inflationRate: 0,
    monthlyContribution: 0,
    createdAt: 0,
  };

  it("calls out a goal with nothing going into it", () => {
    const alerts = evaluateRules(context({ goals: [goal] }));
    const alert = alerts.find((a) => a.kind === "goal-off-track");
    expect(alert?.severity).toBe("serious");
    expect(alert?.title).toContain("nothing going into it");
  });

  it("stays quiet about a goal that is on track", () => {
    const alerts = evaluateRules(
      context({ goals: [{ ...goal, monthlyContribution: 30000 }] }),
    );
    expect(kinds(alerts)).not.toContain("goal-off-track");
  });
});

describe("trend rules", () => {
  const months = ["2026-01", "2026-02", "2026-03"];

  it("flags a savings rate that has fallen against the trailing median", () => {
    const transactions = [
      ...months.flatMap((month) => [
        tx({ date: `${month}-01`, amount: 100000, category: "Income" }),
        tx({ date: `${month}-05`, amount: -50000, category: "Rent" }),
      ]),
      // Latest complete month: saved almost nothing.
      tx({ date: "2026-04-01", amount: 100000, category: "Income" }),
      tx({ date: "2026-04-05", amount: -95000, category: "Rent" }),
    ];

    const alerts = evaluateRules(
      context({ transactions, currentMonth: "2026-05", today: "2026-05-10" }),
    );
    expect(kinds(alerts)).toContain("savings-rate-drop");
  });

  it("flags an income drop", () => {
    const transactions = [
      ...months.flatMap((month) => [
        tx({ date: `${month}-01`, amount: 100000, category: "Income" }),
        tx({ date: `${month}-05`, amount: -20000, category: "Rent" }),
      ]),
      tx({ date: "2026-04-01", amount: 40000, category: "Income" }),
      tx({ date: "2026-04-05", amount: -20000, category: "Rent" }),
    ];

    const alerts = evaluateRules(
      context({ transactions, currentMonth: "2026-05", today: "2026-05-10" }),
    );
    expect(kinds(alerts)).toContain("income-drop");
  });

  it("needs enough history before calling anything a trend", () => {
    const alerts = evaluateRules(
      context({
        transactions: [
          tx({ date: "2026-03-01", amount: 100000, category: "Income" }),
          tx({ date: "2026-04-01", amount: 20000, category: "Income" }),
        ],
        currentMonth: "2026-05",
      }),
    );
    expect(kinds(alerts)).not.toContain("income-drop");
  });
});

describe("transaction rules", () => {
  it("flags a recurring charge that went up", () => {
    const transactions = [
      tx({ date: "2026-01-05", amount: -649, merchant: "netflix", category: "Subscriptions" }),
      tx({ date: "2026-02-05", amount: -649, merchant: "netflix", category: "Subscriptions" }),
      tx({ date: "2026-03-05", amount: -649, merchant: "netflix", category: "Subscriptions" }),
      tx({ date: "2026-04-05", amount: -799, merchant: "netflix", category: "Subscriptions" }),
    ];
    expect(kinds(evaluateRules(context({ transactions })))).toContain("recurring-increase");
  });

  it("flags a possible double charge", () => {
    const transactions = [
      tx({ date: "2026-04-10", amount: -1499, merchant: "gym", description: "GYM FEE" }),
      tx({ date: "2026-04-11", amount: -1499, merchant: "gym", description: "GYM FEE" }),
    ];
    expect(kinds(evaluateRules(context({ transactions })))).toContain(
      "duplicate-transaction",
    );
  });

  it("ignores an unusual charge from months ago", () => {
    // Old trivia is not an alert.
    const old = [
      ...Array.from({ length: 8 }, () =>
        tx({ date: "2025-06-05", amount: -300, category: "Dining" }),
      ),
      tx({ date: "2025-06-06", amount: -20000, category: "Dining" }),
    ];
    expect(kinds(evaluateRules(context({ transactions: old })))).not.toContain(
      "outlier-transaction",
    );
  });
});

describe("allocation drift rule", () => {
  it("fires past the five-point threshold and not before", () => {
    const small = evaluateRules(
      context({
        allocationRows: [
          {
            assetClass: "equity",
            label: "Equity",
            targetShare: 0.6,
            targetAmount: 600000,
            currentAmount: 630000,
            currentShare: 0.63,
            driftShare: 0.03,
            driftAmount: 30000,
            instruments: [],
          },
        ],
      }),
    );
    expect(kinds(small)).not.toContain("allocation-drift");

    const large = evaluateRules(
      context({
        allocationRows: [
          {
            assetClass: "equity",
            label: "Equity",
            targetShare: 0.6,
            targetAmount: 600000,
            currentAmount: 800000,
            currentShare: 0.8,
            driftShare: 0.2,
            driftAmount: 200000,
            instruments: [],
          },
        ],
      }),
    );
    expect(large.find((a) => a.kind === "allocation-drift")?.severity).toBe("serious");
  });
});

describe("evaluateRules", () => {
  it("orders the most severe first", () => {
    const alerts = evaluateRules(
      context({
        interview: {
          ...DEFAULT_INTERVIEW,
          hasHealthInsurance: false,
          totalDebt: 100000,
          highestDebtRate: 0.36,
        },
      }),
    );
    expect(alerts[0].severity).toBe("critical");
  });

  it("never returns two alerts with the same dedupe key", () => {
    // The unique index would reject the second insert and abort the batch.
    const alerts = evaluateRules(
      context({
        interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: false, dependents: 2 },
      }),
    );
    const keys = alerts.map((a) => a.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("produces a stable dedupe key for an unchanged condition", () => {
    // Someone opening the app four times in a day should not collect four
    // identical warnings.
    const ctx = context({
      interview: { ...DEFAULT_INTERVIEW, hasHealthInsurance: false },
    });
    expect(evaluateRules(ctx).map((a) => a.dedupeKey)).toEqual(
      evaluateRules(ctx).map((a) => a.dedupeKey),
    );
  });

  it("returns nothing for a person with nothing wrong", () => {
    const healthy = evaluateRules(
      context({
        interview: {
          ...DEFAULT_INTERVIEW,
          hasHealthInsurance: true,
          dependents: 0,
          liquidSavings: 1000000,
        },
        transactions: ["2026-01", "2026-02", "2026-03"].flatMap((month) => [
          tx({ date: `${month}-01`, amount: 100000, category: "Income" }),
          tx({ date: `${month}-05`, amount: -40000, category: "Rent" }),
        ]),
      }),
    );
    expect(healthy).toHaveLength(0);
  });
});
