import type {
  Allocation,
  AssetClass,
  InstrumentCategory,
  InterviewProfile,
  RiskProfile,
} from "@/lib/db/types";

/**
 * Base allocations by risk profile.
 *
 * Deliberately boring. These are the standard shapes a balanced, a growth and a
 * capital-preservation portfolio take; nothing here is a clever bet, and Ledgr
 * has no business making one. Gold sits at 5–10% throughout as a diversifier,
 * not a conviction.
 */
const BASE_ALLOCATION: Record<RiskProfile, Allocation> = {
  conservative: { equity: 0.3, debt: 0.5, gold: 0.1, cash: 0.1, "real-estate": 0 },
  moderate: { equity: 0.55, debt: 0.3, gold: 0.08, cash: 0.07, "real-estate": 0 },
  aggressive: { equity: 0.75, debt: 0.15, gold: 0.05, cash: 0.05, "real-estate": 0 },
};

export const ASSET_LABEL: Record<AssetClass, string> = {
  equity: "Equity",
  debt: "Debt",
  gold: "Gold",
  cash: "Cash",
  "real-estate": "Real estate",
};

/**
 * The glide path.
 *
 * Equity share should fall as the money gets closer to being spent, not on a
 * birthday. A 30-year-old buying a car in two years needs the same caution as a
 * 60-year-old — the horizon is what matters, and this shifts the allocation on
 * that basis, capped by the risk assessment's own ceiling.
 */
export function glidePath(
  base: Allocation,
  yearsRemaining: number,
  maxEquity: number,
): Allocation {
  let equityCeiling = maxEquity;

  if (yearsRemaining <= 1) equityCeiling = Math.min(equityCeiling, 0);
  else if (yearsRemaining <= 3) equityCeiling = Math.min(equityCeiling, 0.2);
  else if (yearsRemaining <= 5) equityCeiling = Math.min(equityCeiling, 0.4);
  else if (yearsRemaining <= 8) equityCeiling = Math.min(equityCeiling, 0.6);

  const equity = Math.min(base.equity, equityCeiling);
  const freed = base.equity - equity;

  // Whatever equity gives up goes to debt, not to cash. Cash is for the
  // emergency fund and near-term spending; parking a long-horizon allocation
  // there just guarantees losing to inflation more slowly.
  return normalise({
    ...base,
    equity,
    debt: base.debt + freed,
  });
}

function normalise(allocation: Allocation): Allocation {
  const total = Object.values(allocation).reduce((sum, v) => sum + v, 0);
  if (total === 0) return allocation;

  const scaled = Object.fromEntries(
    Object.entries(allocation).map(([key, value]) => [key, value / total]),
  ) as Allocation;

  return scaled;
}

export function targetAllocation(
  risk: RiskProfile,
  maxEquity: number,
  yearsRemaining: number,
): Allocation {
  return glidePath(BASE_ALLOCATION[risk], yearsRemaining, maxEquity);
}

/* -------------------------------------------------------------------------- */
/* Instrument suggestions                                                     */
/* -------------------------------------------------------------------------- */

export interface InstrumentSuggestion {
  instrument: InstrumentCategory;
  label: string;
  /** Share of this asset class, 0..1. */
  weight: number;
  rationale: string;
}

export const INSTRUMENT_LABEL: Record<InstrumentCategory, string> = {
  "index-fund": "Broad index fund",
  "flexi-cap-fund": "Flexi-cap equity fund",
  elss: "ELSS (tax-saving equity fund)",
  "international-equity": "International equity fund",
  ppf: "PPF",
  epf: "EPF / VPF",
  nps: "NPS",
  "debt-fund": "Debt mutual fund",
  "fixed-deposit": "Fixed deposit",
  "liquid-fund": "Liquid fund",
  "gold-etf": "Gold ETF",
  sgb: "Sovereign Gold Bond",
  "savings-account": "Savings account",
  reit: "REIT",
  "direct-stocks": "Direct stocks",
  other: "Other",
};

/**
 * Suggests instrument *categories* for an asset class.
 *
 * Never a named fund or scheme. Ledgr has no live NAV data, no view on any
 * manager, and no business implying one — and a recommendation naming a
 * specific product is regulated advice, which this is not. Categories are
 * useful and honest: "the debt portion belongs in PPF or EPF" is actionable
 * without pretending to knowledge Ledgr does not have.
 */
export function suggestInstruments(
  assetClass: AssetClass,
  profile: InterviewProfile,
  horizonYears: number,
): InstrumentSuggestion[] {
  switch (assetClass) {
    case "equity": {
      const suggestions: InstrumentSuggestion[] = [
        {
          instrument: "index-fund",
          label: INSTRUMENT_LABEL["index-fund"],
          weight: 0.6,
          rationale:
            "The core holding. Low cost, no manager risk, and it captures the market return rather than trying to beat it.",
        },
        {
          instrument: "international-equity",
          label: INSTRUMENT_LABEL["international-equity"],
          weight: 0.2,
          rationale:
            "Diversifies away from a single country's fortunes. Your income is already fully exposed to India.",
        },
      ];

      // ELSS only earns its lock-in if there is tax to save and time to serve it.
      if (profile.taxBracket >= 0.2 && horizonYears >= 5) {
        suggestions.push({
          instrument: "elss",
          label: INSTRUMENT_LABEL.elss,
          weight: 0.2,
          rationale: `At a ${(profile.taxBracket * 100).toFixed(0)}% slab, the 80C deduction is worth the three-year lock-in.`,
        });
      } else {
        suggestions.push({
          instrument: "flexi-cap-fund",
          label: INSTRUMENT_LABEL["flexi-cap-fund"],
          weight: 0.2,
          rationale:
            "A single actively-managed fund that can move across market caps, if you want some exposure beyond the index.",
        });
      }

      return suggestions;
    }

    case "debt": {
      const suggestions: InstrumentSuggestion[] = [
        {
          instrument: "epf",
          label: INSTRUMENT_LABEL.epf,
          weight: 0.4,
          rationale:
            "Usually already running through payroll, and usually the best risk-adjusted debt return available. Count it before buying anything else.",
        },
      ];

      if (horizonYears >= 15) {
        suggestions.push({
          instrument: "ppf",
          label: INSTRUMENT_LABEL.ppf,
          weight: 0.3,
          rationale:
            "Tax-free and government-backed, but locked for fifteen years — which only works on a horizon at least that long.",
        });
      } else {
        suggestions.push({
          instrument: "debt-fund",
          label: INSTRUMENT_LABEL["debt-fund"],
          weight: 0.3,
          rationale:
            "Liquid enough for a shorter horizon, and taxed better than a fixed deposit if held over three years.",
        });
      }

      if (profile.taxBracket >= 0.3 && profile.age < profile.retirementAge - 10) {
        suggestions.push({
          instrument: "nps",
          label: INSTRUMENT_LABEL.nps,
          weight: 0.3,
          rationale:
            "An extra ₹50,000 deduction beyond 80C. Locked until 60, so it only suits money you were never going to touch.",
        });
      } else {
        suggestions.push({
          instrument: "fixed-deposit",
          label: INSTRUMENT_LABEL["fixed-deposit"],
          weight: 0.3,
          rationale: "Simple and predictable. Worse after tax than a debt fund, better than nothing.",
        });
      }

      return suggestions;
    }

    case "gold":
      return horizonYears >= 8
        ? [
            {
              instrument: "sgb",
              label: INSTRUMENT_LABEL.sgb,
              weight: 1,
              rationale:
                "Pays 2.5% interest on top of the gold price and is capital-gains free if held to maturity — but it is an eight-year commitment.",
            },
          ]
        : [
            {
              instrument: "gold-etf",
              label: INSTRUMENT_LABEL["gold-etf"],
              weight: 1,
              rationale:
                "Tracks the gold price without storage or making charges, and can be sold whenever you need it.",
            },
          ];

    case "cash":
      return [
        {
          instrument: "liquid-fund",
          label: INSTRUMENT_LABEL["liquid-fund"],
          weight: 0.6,
          rationale:
            "Where an emergency fund should sit past the first month — accessible in a day, but not earning nothing.",
        },
        {
          instrument: "savings-account",
          label: INSTRUMENT_LABEL["savings-account"],
          weight: 0.4,
          rationale: "The first month of the buffer, where it has to be instantly available.",
        },
      ];

    case "real-estate":
      return [
        {
          instrument: "reit",
          label: INSTRUMENT_LABEL.reit,
          weight: 1,
          rationale:
            "Property exposure without the concentration, illiquidity and paperwork of owning a unit.",
        },
      ];
  }
}

/* -------------------------------------------------------------------------- */
/* The plan                                                                   */
/* -------------------------------------------------------------------------- */

export interface AllocationRow {
  assetClass: AssetClass;
  label: string;
  targetShare: number;
  targetAmount: number;
  currentAmount: number;
  currentShare: number;
  /** Positive means over-allocated relative to target. */
  driftShare: number;
  driftAmount: number;
  instruments: InstrumentSuggestion[];
}

export interface InvestmentPlan {
  rows: AllocationRow[];
  totalCurrent: number;
  monthlyInvestable: number;
  /** What is left to do before investing makes sense: buffer, cover, debt. */
  prerequisites: Prerequisite[];
  /** Absolute drift across all classes, as a share of the portfolio. */
  totalDrift: number;
}

export interface Prerequisite {
  id: string;
  title: string;
  detail: string;
  amount: number;
  severity: "critical" | "serious" | "warning";
}

/**
 * The order of operations before investing.
 *
 * This exists because the honest answer to "how should I invest?" is often
 * "not yet". Health cover, an emergency buffer and expensive debt all beat any
 * expected market return, and a tool that skips straight to asset allocation
 * while someone carries a 40% credit card balance is giving bad advice
 * attractively.
 */
export function prerequisites(
  profile: InterviewProfile,
  monthlyExpense: number,
  bufferMonths: number,
  expectedReturn: number,
): Prerequisite[] {
  const items: Prerequisite[] = [];

  if (!profile.hasHealthInsurance) {
    items.push({
      id: "health-cover",
      title: "Get health insurance",
      detail:
        "One hospital stay can undo a decade of investing. This comes before any allocation question.",
      amount: 0,
      severity: "critical",
    });
  }

  const bufferTarget = monthlyExpense * bufferMonths;
  const bufferGap = bufferTarget - profile.liquidSavings;
  if (bufferGap > 0 && monthlyExpense > 0) {
    items.push({
      id: "emergency-fund",
      title: `Build a ${bufferMonths}-month emergency fund`,
      detail:
        "Without a buffer, the first bad month forces you to sell investments at whatever price the market happens to offer.",
      amount: bufferGap,
      severity: profile.liquidSavings < monthlyExpense ? "critical" : "serious",
    });
  }

  if (profile.totalDebt > 0 && profile.highestDebtRate > expectedReturn) {
    items.push({
      id: "expensive-debt",
      title: `Clear debt costing ${(profile.highestDebtRate * 100).toFixed(0)}%`,
      detail: `Paying this down returns ${(profile.highestDebtRate * 100).toFixed(0)}% guaranteed. Investing instead is betting on beating that, after tax, with risk.`,
      amount: profile.totalDebt,
      severity: profile.highestDebtRate >= 0.24 ? "critical" : "warning",
    });
  }

  if (profile.dependents > 0 && !profile.hasTermInsurance) {
    items.push({
      id: "term-cover",
      title: "Get term life cover",
      detail: `${profile.dependents} ${profile.dependents === 1 ? "person depends" : "people depend"} on your income. Term cover is cheap and this is what it is for.`,
      amount: 0,
      severity: "serious",
    });
  }

  return items;
}

export function buildPlan(options: {
  profile: InterviewProfile;
  risk: RiskProfile;
  maxEquity: number;
  horizonYears: number;
  monthlyInvestable: number;
  monthlyExpense: number;
  bufferMonths: number;
  expectedReturn: number;
  /** Actual holdings by asset class, from the portfolio. */
  currentByClass?: Partial<Record<AssetClass, number>>;
}): InvestmentPlan {
  const {
    profile,
    risk,
    maxEquity,
    horizonYears,
    monthlyInvestable,
    monthlyExpense,
    bufferMonths,
    expectedReturn,
    currentByClass,
  } = options;

  const target = targetAllocation(risk, maxEquity, horizonYears);

  // Fall back to what the interview reported when no holdings are imported, so
  // the plan is not blank for someone who told it what they own in the fact-find.
  const current: Record<AssetClass, number> = {
    equity: currentByClass?.equity ?? profile.equityValue,
    debt: currentByClass?.debt ?? profile.debtInvestmentValue,
    gold: currentByClass?.gold ?? profile.goldValue,
    cash: currentByClass?.cash ?? profile.liquidSavings,
    "real-estate": currentByClass?.["real-estate"] ?? 0,
  };

  const totalCurrent = Object.values(current).reduce((sum, v) => sum + v, 0);

  const rows: AllocationRow[] = (Object.keys(target) as AssetClass[])
    .filter((assetClass) => target[assetClass] > 0 || current[assetClass] > 0)
    .map((assetClass) => {
      const targetShare = target[assetClass];
      const currentAmount = current[assetClass];
      const currentShare = totalCurrent === 0 ? 0 : currentAmount / totalCurrent;

      return {
        assetClass,
        label: ASSET_LABEL[assetClass],
        targetShare,
        targetAmount: totalCurrent * targetShare,
        currentAmount,
        currentShare,
        driftShare: currentShare - targetShare,
        driftAmount: currentAmount - totalCurrent * targetShare,
        instruments: suggestInstruments(assetClass, profile, horizonYears),
      };
    });

  const totalDrift =
    rows.reduce((sum, row) => sum + Math.abs(row.driftShare), 0) / 2;

  return {
    rows,
    totalCurrent,
    monthlyInvestable,
    prerequisites: prerequisites(profile, monthlyExpense, bufferMonths, expectedReturn),
    totalDrift,
  };
}

/**
 * How to split the next month's contribution.
 *
 * Directs new money toward whatever is *under* target rather than splitting it
 * by the target weights. Rebalancing by buying is free; rebalancing by selling
 * costs tax and exit loads, so the plan closes gaps with contributions first
 * and only suggests selling when new money alone cannot do it.
 */
export function contributionSplit(
  rows: AllocationRow[],
  monthlyInvestable: number,
): Array<{ assetClass: AssetClass; label: string; amount: number; share: number }> {
  if (monthlyInvestable <= 0) return [];

  const under = rows
    .map((row) => ({ row, gap: Math.max(0, -row.driftAmount) }))
    .filter((item) => item.gap > 0);

  const totalGap = under.reduce((sum, item) => sum + item.gap, 0);

  // Already balanced, or nothing held yet: fall back to the target weights.
  if (totalGap <= 0) {
    return rows
      .filter((row) => row.targetShare > 0)
      .map((row) => ({
        assetClass: row.assetClass,
        label: row.label,
        amount: monthlyInvestable * row.targetShare,
        share: row.targetShare,
      }));
  }

  return under.map(({ row, gap }) => ({
    assetClass: row.assetClass,
    label: row.label,
    amount: monthlyInvestable * (gap / totalGap),
    share: gap / totalGap,
  }));
}
