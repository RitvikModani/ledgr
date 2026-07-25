import { describe, expect, it } from "vitest";
import type { Goal, Holding, Transaction } from "@/lib/db/types";
import { DEFAULT_INTERVIEW } from "@/lib/db/types";
import {
  allocateSurplus,
  assessGoal,
  futureValue,
  futureValueOfSeries,
  inflatedTarget,
  project,
  requiredMonthly,
} from "./goals";
import { autoBudget, spendAgainstBudget } from "./budget";
import {
  buildPlan,
  contributionSplit,
  glidePath,
  prerequisites,
  targetAllocation,
} from "@/lib/invest/allocation";
import { holdingReturn, rebalanceActions, summarisePortfolio, xirr } from "@/lib/invest/portfolio";

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

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    name: "Goal",
    kind: "custom",
    targetAmount: 1000000,
    currentAmount: 0,
    targetDate: "2036-04-01",
    priority: "medium",
    expectedAnnualReturn: 0.12,
    inflationRate: 0,
    monthlyContribution: 0,
    createdAt: 0,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe("compound growth", () => {
  it("grows a lump sum", () => {
    // 100000 at 12% nominal, compounded monthly, for one year.
    expect(futureValue(100000, 0.12, 12)).toBeCloseTo(112682.5, 0);
  });

  it("grows a monthly series", () => {
    // 10000 a month at 12% for 12 months.
    expect(futureValueOfSeries(10000, 0.12, 12)).toBeCloseTo(126825.03, 0);
  });

  it("handles a zero return without dividing by zero", () => {
    // A savings-account goal is a perfectly reasonable thing to model, and the
    // standard annuity formula would return NaN for it.
    expect(futureValueOfSeries(5000, 0, 24)).toBe(120000);
    expect(requiredMonthly(120000, 0, 0, 24)).toBe(5000);
  });

  it("solves the contribution that reaches a target", () => {
    const monthly = requiredMonthly(1000000, 0, 0.12, 60);
    expect(futureValueOfSeries(monthly, 0.12, 60)).toBeCloseTo(1000000, 0);
  });

  it("credits an existing balance against what is still needed", () => {
    const withNothing = requiredMonthly(1000000, 0, 0.12, 60);
    const withHalf = requiredMonthly(1000000, 500000, 0.12, 60);
    expect(withHalf).toBeLessThan(withNothing);
  });

  it("asks for nothing when the existing balance already gets there", () => {
    expect(requiredMonthly(100000, 900000, 0.12, 60)).toBe(0);
  });

  it("inflates a target to what it will actually cost", () => {
    // A 50 lakh house today is not a 50 lakh house in ten years.
    const inflated = inflatedTarget(5000000, 0.06, 120);
    expect(inflated).toBeGreaterThan(9000000);
  });
});

describe("assessGoal", () => {
  it("calls a fully funded goal on track", () => {
    const result = assessGoal(
      goal({ targetAmount: 1000000, monthlyContribution: 13000, targetDate: "2031-04-01" }),
      "2026-04",
    );
    expect(result.status).toBe("on-track");
    expect(result.monthlyShortfall).toBe(0);
  });

  it("calls an unfunded goal unfunded, not merely off track", () => {
    const result = assessGoal(goal({ monthlyContribution: 0 }), "2026-04");
    expect(result.status).toBe("unfunded");
    expect(result.requiredMonthly).toBeGreaterThan(0);
  });

  it("reports the monthly shortfall on an underfunded goal", () => {
    const result = assessGoal(
      goal({ targetAmount: 1000000, monthlyContribution: 2000, targetDate: "2031-04-01" }),
      "2026-04",
    );
    expect(result.status).toBe("off-track");
    expect(result.monthlyShortfall).toBeGreaterThan(0);
    expect(result.shortfall).toBeGreaterThan(0);
  });

  it("marks an already-met goal achieved", () => {
    const result = assessGoal(
      goal({ targetAmount: 100000, currentAmount: 150000 }),
      "2026-04",
    );
    expect(result.status).toBe("achieved");
  });

  it("says how late a goal lands at the current contribution", () => {
    const result = assessGoal(
      goal({ targetAmount: 1000000, monthlyContribution: 8000, targetDate: "2031-04-01" }),
      "2026-04",
    );
    expect(result.monthsLate).toBeGreaterThan(0);
  });

  it("prices in inflation, so a nominal target is not mistaken for the real one", () => {
    const nominal = assessGoal(goal({ inflationRate: 0 }), "2026-04");
    const real = assessGoal(goal({ inflationRate: 0.06 }), "2026-04");
    expect(real.targetAtMaturity).toBeGreaterThan(nominal.targetAtMaturity);
    expect(real.requiredMonthly).toBeGreaterThan(nominal.requiredMonthly);
  });
});

describe("allocateSurplus", () => {
  const goals = [
    goal({ name: "Emergency", priority: "high", targetAmount: 300000, targetDate: "2028-04-01" }),
    goal({ name: "House", priority: "medium", targetAmount: 2000000, targetDate: "2033-04-01" }),
    goal({ name: "Holiday", priority: "low", targetAmount: 200000, targetDate: "2029-04-01" }),
  ];

  it("fully funds by priority rather than spreading thin", () => {
    // Partially funding three goals means missing three dates; fully funding
    // one means hitting one.
    const result = allocateSurplus(goals, 12000, "2026-04");

    const emergency = result.allocations.find((a) => a.goal.name === "Emergency");
    expect(emergency?.allocated).toBe(emergency?.assessment.requiredMonthly);
    expect(result.constrained).toBe(true);
  });

  it("leaves later goals unmet and says by how much", () => {
    const result = allocateSurplus(goals, 12000, "2026-04");
    const unmet = result.allocations.filter((a) => a.unmet > 0);
    expect(unmet.length).toBeGreaterThan(0);
  });

  it("funds everything and reports the remainder when the surplus is ample", () => {
    const result = allocateSurplus(goals, 500000, "2026-04");
    expect(result.constrained).toBe(false);
    expect(result.leftOver).toBeGreaterThan(0);
    expect(result.allocations.every((a) => a.unmet === 0)).toBe(true);
  });

  it("orders the nearer deadline first within a priority band", () => {
    const sameBand = [
      goal({ name: "Far", priority: "high", targetDate: "2040-04-01" }),
      goal({ name: "Near", priority: "high", targetDate: "2028-04-01" }),
    ];
    const result = allocateSurplus(sameBand, 1000, "2026-04");
    expect(result.allocations[0].goal.name).toBe("Near");
  });
});

describe("project", () => {
  it("returns one row per month including the start", () => {
    const rows = project({
      startingAmount: 0,
      monthlyContribution: 1000,
      annualReturn: 0.12,
      months: 12,
      startMonth: "2026-04",
    });
    expect(rows).toHaveLength(13);
    expect(rows[0].value).toBe(0);
    expect(rows.at(-1)?.month).toBe("2027-04");
  });

  it("grows faster with an annual step-up", () => {
    // A SIP frozen at today's income for twenty years shrinks in real terms
    // every year.
    const flat = project({
      startingAmount: 0,
      monthlyContribution: 10000,
      annualReturn: 0.12,
      months: 120,
    });
    const stepped = project({
      startingAmount: 0,
      monthlyContribution: 10000,
      annualReturn: 0.12,
      months: 120,
      annualStepUp: 0.1,
    });

    expect(stepped.at(-1)!.value).toBeGreaterThan(flat.at(-1)!.value * 1.4);
  });

  it("tracks contributions separately from growth", () => {
    const rows = project({
      startingAmount: 50000,
      monthlyContribution: 1000,
      annualReturn: 0.12,
      months: 24,
    });
    const last = rows.at(-1)!;
    expect(last.contributed).toBe(50000 + 24000);
    expect(last.value).toBeGreaterThan(last.contributed);
  });
});

/* -------------------------------------------------------------------------- */

describe("autoBudget", () => {
  const history = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"].flatMap(
    (month) => [
      tx({ date: `${month}-02`, amount: -30000, category: "Rent" }),
      tx({ date: `${month}-08`, amount: -8000, category: "Groceries" }),
      tx({ date: `${month}-15`, amount: -3000, category: "Dining" }),
    ],
  );

  it("derives an envelope per category from the median month", () => {
    const budget = autoBudget(history);
    const byCategory = Object.fromEntries(budget.envelopes.map((e) => [e.category, e]));

    expect(byCategory.Rent.typical).toBe(30000);
    expect(byCategory.Groceries.typical).toBe(8000);
  });

  it("does not trim essentials, which are contracts rather than choices", () => {
    const budget = autoBudget(history);
    const byCategory = Object.fromEntries(budget.envelopes.map((e) => [e.category, e]));

    expect(byCategory.Rent.monthlyLimit).toBe(30000);
    expect(byCategory.Dining.monthlyLimit).toBeLessThan(byCategory.Dining.typical);
  });

  it("is not dragged upward by one expensive month", () => {
    const withSplurge = [
      ...history,
      tx({ date: "2026-03-20", amount: -200000, category: "Dining" }),
    ];
    const budget = autoBudget(withSplurge);
    const dining = budget.envelopes.find((e) => e.category === "Dining");

    // A mean would put this near 36,000.
    expect(dining!.typical).toBeLessThan(6000);
  });

  it("counts months with no spend as zero, not as missing", () => {
    // A category bought once a quarter is not a monthly expense.
    const quarterly = [
      ...history,
      tx({ date: "2026-01-10", amount: -12000, category: "Shopping" }),
    ];
    const budget = autoBudget(quarterly);
    const shopping = budget.envelopes.find((e) => e.category === "Shopping");
    expect(shopping).toBeUndefined();
  });

  it("flags thin history rather than presenting a guess as a budget", () => {
    const twoMonths = [
      tx({ date: "2026-05-02", amount: -5000, category: "Dining" }),
      tx({ date: "2026-06-02", amount: -5000, category: "Dining" }),
    ];
    expect(autoBudget(twoMonths).envelopes[0].thin).toBe(true);
  });

  it("excludes income, transfers, investments and EMI", () => {
    const mixed = [
      ...history,
      tx({ date: "2026-06-01", amount: 120000, category: "Income" }),
      tx({ date: "2026-06-02", amount: -20000, category: "Investments" }),
      tx({ date: "2026-06-03", amount: -25000, category: "EMI" }),
    ];
    const categories = autoBudget(mixed).envelopes.map((e) => e.category);
    expect(categories).not.toContain("Income");
    expect(categories).not.toContain("Investments");
    expect(categories).not.toContain("EMI");
  });

  it("returns nothing when there is no history", () => {
    expect(autoBudget([]).envelopes).toHaveLength(0);
  });
});

describe("spendAgainstBudget", () => {
  it("reports spend and ratio for the month asked for", () => {
    const rows = spendAgainstBudget(
      [
        tx({ date: "2026-04-05", amount: -9000, category: "Groceries" }),
        tx({ date: "2026-03-05", amount: -50000, category: "Groceries" }),
      ],
      [{ category: "Groceries", monthlyLimit: 8000 }],
      "2026-04",
    );

    expect(rows[0].spent).toBe(9000);
    expect(rows[0].ratio).toBeCloseTo(1.125);
  });
});

/* -------------------------------------------------------------------------- */

describe("targetAllocation and glidePath", () => {
  it("gives more equity to a higher risk profile", () => {
    const conservative = targetAllocation("conservative", 0.35, 20);
    const aggressive = targetAllocation("aggressive", 0.8, 20);
    expect(aggressive.equity).toBeGreaterThan(conservative.equity);
  });

  it("always sums to one", () => {
    for (const years of [1, 3, 5, 8, 20]) {
      const total = Object.values(targetAllocation("aggressive", 0.8, years)).reduce(
        (sum, v) => sum + v,
        0,
      );
      expect(total).toBeCloseTo(1);
    }
  });

  it("takes equity out entirely inside a year", () => {
    // Money needed next year does not belong in the market, whatever the
    // investor's temperament.
    expect(targetAllocation("aggressive", 0.8, 1).equity).toBe(0);
  });

  it("de-risks steadily as the horizon shortens", () => {
    const long = targetAllocation("aggressive", 0.8, 20).equity;
    const medium = targetAllocation("aggressive", 0.8, 7).equity;
    const short = targetAllocation("aggressive", 0.8, 3).equity;

    expect(long).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(short);
  });

  it("moves what equity gives up into debt rather than cash", () => {
    const base = { equity: 0.75, debt: 0.15, gold: 0.05, cash: 0.05, "real-estate": 0 };
    const glided = glidePath(base, 3, 0.8);
    expect(glided.debt).toBeGreaterThan(base.debt);
    expect(glided.cash).toBeCloseTo(base.cash / (1 - 0), 1);
  });

  it("respects the risk assessment's equity ceiling", () => {
    expect(targetAllocation("aggressive", 0.35, 20).equity).toBeLessThanOrEqual(0.36);
  });
});

describe("prerequisites", () => {
  it("puts health cover before any allocation question", () => {
    const items = prerequisites(
      { ...DEFAULT_INTERVIEW, hasHealthInsurance: false },
      50000,
      6,
      0.12,
    );
    expect(items[0].id).toBe("health-cover");
    expect(items[0].severity).toBe("critical");
  });

  it("flags an emergency-fund gap", () => {
    const items = prerequisites(
      { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 50000 },
      50000,
      6,
      0.12,
    );
    const buffer = items.find((i) => i.id === "emergency-fund");
    expect(buffer?.amount).toBe(250000);
  });

  it("flags debt that costs more than the expected return", () => {
    const items = prerequisites(
      {
        ...DEFAULT_INTERVIEW,
        hasHealthInsurance: true,
        liquidSavings: 1000000,
        totalDebt: 200000,
        highestDebtRate: 0.36,
      },
      50000,
      6,
      0.12,
    );
    expect(items.find((i) => i.id === "expensive-debt")?.severity).toBe("critical");
  });

  it("leaves cheap debt alone", () => {
    const items = prerequisites(
      {
        ...DEFAULT_INTERVIEW,
        hasHealthInsurance: true,
        liquidSavings: 1000000,
        totalDebt: 2000000,
        highestDebtRate: 0.085,
      },
      50000,
      6,
      0.12,
    );
    expect(items.find((i) => i.id === "expensive-debt")).toBeUndefined();
  });

  it("only asks for term cover when someone depends on the income", () => {
    const noDependents = prerequisites(
      { ...DEFAULT_INTERVIEW, hasHealthInsurance: true, liquidSavings: 1000000, dependents: 0 },
      50000,
      6,
      0.12,
    );
    expect(noDependents.find((i) => i.id === "term-cover")).toBeUndefined();
  });
});

describe("buildPlan and contributionSplit", () => {
  const plan = buildPlan({
    profile: {
      ...DEFAULT_INTERVIEW,
      hasHealthInsurance: true,
      equityValue: 200000,
      debtInvestmentValue: 700000,
      goldValue: 0,
      liquidSavings: 100000,
    },
    risk: "moderate",
    maxEquity: 0.6,
    horizonYears: 20,
    monthlyInvestable: 20000,
    monthlyExpense: 10000,
    bufferMonths: 6,
    expectedReturn: 0.12,
  });

  it("computes drift against the target", () => {
    const equity = plan.rows.find((r) => r.assetClass === "equity")!;
    // 2L of 10L is 20% against a 55% target.
    expect(equity.currentShare).toBeCloseTo(0.2);
    expect(equity.driftShare).toBeLessThan(0);
  });

  it("directs new money at what is under target rather than at the target weights", () => {
    // Rebalancing by buying is free; rebalancing by selling costs tax.
    const split = contributionSplit(plan.rows, 20000);
    const equityShare = split.find((s) => s.assetClass === "equity")?.share ?? 0;
    expect(equityShare).toBeGreaterThan(0.55);
  });

  it("falls back to target weights when nothing is held yet", () => {
    const empty = buildPlan({
      profile: { ...DEFAULT_INTERVIEW, hasHealthInsurance: true },
      risk: "moderate",
      maxEquity: 0.6,
      horizonYears: 20,
      monthlyInvestable: 10000,
      monthlyExpense: 0,
      bufferMonths: 6,
      expectedReturn: 0.12,
    });

    const split = contributionSplit(empty.rows, 10000);
    expect(split.reduce((sum, s) => sum + s.amount, 0)).toBeCloseTo(10000);
  });

  it("returns nothing to invest when there is nothing to invest", () => {
    expect(contributionSplit(plan.rows, 0)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("xirr", () => {
  it("recovers a known annual rate", () => {
    const rate = xirr([
      { date: "2024-01-01", amount: -100000 },
      { date: "2025-01-01", amount: 110000 },
    ]);
    expect(rate).toBeCloseTo(0.1, 2);
  });

  it("weights each contribution by when it actually went in", () => {
    // A CAGR over the average would flatter the recent money.
    const rate = xirr([
      { date: "2020-01-01", amount: -100000 },
      { date: "2025-01-01", amount: -100000 },
      { date: "2026-01-01", amount: 260000 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
  });

  it("handles a loss", () => {
    const rate = xirr([
      { date: "2024-01-01", amount: -100000 },
      { date: "2025-01-01", amount: 80000 },
    ]);
    expect(rate).toBeCloseTo(-0.2, 2);
  });

  it("converges near break-even, where Newton alone diverges", () => {
    const rate = xirr([
      { date: "2024-01-01", amount: -100000 },
      { date: "2025-01-01", amount: 100000 },
    ]);
    expect(rate).toBeCloseTo(0, 3);
  });

  it("returns null when there is no sign change to solve for", () => {
    expect(xirr([{ date: "2024-01-01", amount: -1000 }])).toBeNull();
    expect(
      xirr([
        { date: "2024-01-01", amount: -1000 },
        { date: "2025-01-01", amount: -1000 },
      ]),
    ).toBeNull();
  });
});

describe("portfolio returns", () => {
  function holding(overrides: Partial<Holding> = {}): Holding {
    return {
      name: "Fund",
      assetClass: "equity",
      instrument: "index-fund",
      units: 100,
      avgCost: 100,
      currentValue: 12000,
      purchaseDate: "2024-07-25",
      updatedAt: 0,
      ...overrides,
    };
  }

  it("computes absolute and annualised return", () => {
    const result = holdingReturn(holding(), "2026-07-25");
    expect(result.invested).toBe(10000);
    expect(result.absoluteReturn).toBeCloseTo(0.2);
    expect(result.annualisedReturn).toBeCloseTo(0.0954, 2);
  });

  it("refuses to annualise a holding a few weeks old", () => {
    // A 2% move over three weeks annualises to something absurd.
    const result = holdingReturn(
      holding({ purchaseDate: "2026-07-10" }),
      "2026-07-25",
    );
    expect(result.annualisedReturn).toBeNull();
  });

  it("summarises the portfolio by asset class", () => {
    const summary = summarisePortfolio(
      [
        holding({ assetClass: "equity", currentValue: 600000 }),
        holding({ assetClass: "debt", currentValue: 400000 }),
      ],
      "2026-07-25",
    );

    expect(summary.currentValue).toBe(1000000);
    expect(summary.byClass.equity).toBe(600000);
    expect(summary.byClass.debt).toBe(400000);
    expect(summary.annualisedReturn).not.toBeNull();
  });

  it("handles an empty portfolio without dividing by zero", () => {
    const summary = summarisePortfolio([], "2026-07-25");
    expect(summary.currentValue).toBe(0);
    expect(summary.absoluteReturn).toBe(0);
    expect(summary.annualisedReturn).toBeNull();
  });
});

describe("rebalanceActions", () => {
  const rows = [
    { assetClass: "equity" as const, label: "Equity", driftShare: 0.12, driftAmount: 120000 },
    { assetClass: "debt" as const, label: "Debt", driftShare: -0.12, driftAmount: -120000 },
    { assetClass: "gold" as const, label: "Gold", driftShare: 0.02, driftAmount: 20000 },
  ];

  it("ignores drift inside the threshold", () => {
    // Chasing a 2% deviation is churn dressed as discipline.
    const actions = rebalanceActions(rows);
    expect(actions.map((a) => a.assetClass)).not.toContain("gold");
  });

  it("says sell for over-allocated and buy for under-allocated", () => {
    const actions = rebalanceActions(rows);
    expect(actions.find((a) => a.assetClass === "equity")?.action).toBe("sell");
    expect(actions.find((a) => a.assetClass === "debt")?.action).toBe("buy");
  });
});
