import type { CurrencyCode } from "@/lib/format/currency";
import type { ISODate, MonthKey } from "@/lib/format/date";

/**
 * Sign convention, applied everywhere in the app:
 *
 *   income   -> positive amount
 *   expense  -> negative amount
 *
 * Cash flow is then just a sum, and no aggregate needs to know a transaction's
 * type to add it up. The importer is responsible for normalising whatever the
 * source sheet used (Dr/Cr columns, separate debit/credit columns, all-positive
 * expense lists) into this one convention.
 */
export interface Transaction {
  id?: number;
  date: ISODate;
  /** Month key, denormalised so monthly aggregates can use an index. */
  month: MonthKey;
  description: string;
  /** Lowercased, punctuation- and reference-stripped. Drives categorisation and dedupe. */
  merchant: string;
  amount: number;
  category: string;
  account: string;
  /** Running balance from the statement, when the sheet provided one. */
  balance?: number;
  /** Stable fingerprint of date + amount + merchant. Unique index. */
  hash: string;
  importId: string;
  /** True when the user re-categorised this row by hand; the classifier leaves it alone. */
  categoryLocked?: boolean;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  sheetName: string;
  importedAt: number;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsDuplicate: number;
}

export type GoalKind =
  | "emergency-fund"
  | "home"
  | "retirement"
  | "education"
  | "vehicle"
  | "travel"
  | "debt-payoff"
  | "custom";

export type GoalPriority = "high" | "medium" | "low";

export interface Goal {
  id?: number;
  name: string;
  kind: GoalKind;
  targetAmount: number;
  /** Already saved toward this goal. */
  currentAmount: number;
  targetDate: ISODate;
  priority: GoalPriority;
  /** Expected nominal annual return, as a fraction. 0.12 = 12% p.a. */
  expectedAnnualReturn: number;
  /** Assumed annual inflation on the target amount, as a fraction. */
  inflationRate: number;
  /** What the user actually contributes each month right now. */
  monthlyContribution: number;
  createdAt: number;
  notes?: string;
}

export interface Budget {
  id?: number;
  category: string;
  monthlyLimit: number;
  /** True when derived by auto-budget rather than typed by the user. */
  auto: boolean;
  updatedAt: number;
}

export type AlertSeverity = "good" | "warning" | "serious" | "critical";

export type AlertKind =
  | "budget-exceeded"
  | "budget-pace"
  | "low-runway"
  | "goal-off-track"
  | "savings-rate-drop"
  | "outlier-transaction"
  | "upcoming-bill"
  | "recurring-increase"
  | "duplicate-transaction"
  | "income-drop"
  | "allocation-drift"
  | "sip-shortfall"
  | "emergency-fund-gap"
  | "high-interest-debt"
  | "underinsured";

export interface Alert {
  id?: number;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
  /** Identity of the *condition*, not the occurrence. Re-evaluating an unchanged
   *  condition must not create a second alert — see alerts/engine.ts. */
  dedupeKey: string;
  createdAt: number;
  acknowledgedAt?: number;
  /** Set once the alert has been included in a sent email digest. */
  digestedAt?: number;
  /** Set once a browser notification has been raised, so it fires only once. */
  notifiedAt?: number;
  /** Deep link to the page that explains or resolves the alert. */
  href?: string;
  /** Whatever numbers the rule used, for rendering detail without recomputation. */
  context?: Record<string, number | string>;
}

export interface Scenario {
  id?: number;
  name: string;
  createdAt: number;
  incomeChangePct: number;
  extraMonthlyContribution: number;
  returnRateOverride: number | null;
  targetDateShiftMonths: number;
  /** category -> fraction cut, 0.2 meaning "spend 20% less here". */
  categoryCuts: Record<string, number>;
}

export interface CategoryOverride {
  /** Normalised merchant string. */
  merchant: string;
  category: string;
  updatedAt: number;
}

/* --------------------------------------------------------------------------
   Investing
-------------------------------------------------------------------------- */

export type AssetClass = "equity" | "debt" | "gold" | "cash" | "real-estate";

/**
 * Instrument *categories*, never named funds or AMCs.
 *
 * Ledgr is an educational planning tool, not registered investment advice. It
 * can legitimately say "put the debt portion in PPF or EPF"; it must not say
 * "buy the XYZ Bluechip Fund" — that needs live NAV data it cannot source, ages
 * badly, and reads as regulated advice.
 */
export type InstrumentCategory =
  | "index-fund"
  | "flexi-cap-fund"
  | "elss"
  | "international-equity"
  | "ppf"
  | "epf"
  | "nps"
  | "debt-fund"
  | "fixed-deposit"
  | "liquid-fund"
  | "gold-etf"
  | "sgb"
  | "savings-account"
  | "reit"
  | "direct-stocks"
  | "other";

export interface Holding {
  id?: number;
  name: string;
  assetClass: AssetClass;
  instrument: InstrumentCategory;
  units: number;
  /** Average cost per unit. `units * avgCost` is the invested amount. */
  avgCost: number;
  currentValue: number;
  /** Used as the cash-outflow date when computing portfolio XIRR. */
  purchaseDate: ISODate;
  updatedAt: number;
  importId?: string;
  notes?: string;
}

export type RiskProfile = "conservative" | "moderate" | "aggressive";

/** Target weights across asset classes. Must sum to 1. */
export type Allocation = Record<AssetClass, number>;

/* --------------------------------------------------------------------------
   The fact-find

   Every field carries a usable default, and `answered` records which ones the
   user actually supplied. That distinction matters: the plan is allowed to run
   on defaults, but it must be able to say "this number is assumed, not yours"
   and point at the question that would sharpen it.
-------------------------------------------------------------------------- */

export type IncomeStability = "very-stable" | "stable" | "variable" | "irregular";
export type MarketDropReaction = "sell-all" | "sell-some" | "hold" | "buy-more";
export type HousingStatus = "rented" | "owned-with-loan" | "owned-outright" | "family-home";

export interface InterviewProfile {
  id: "singleton";

  // About you
  age: number;
  retirementAge: number;
  dependents: number;
  supportsParents: boolean;

  // Income
  monthlyTakeHome: number;
  otherMonthlyIncome: number;
  incomeStability: IncomeStability;
  expectedAnnualRaise: number;

  // Obligations
  housing: HousingStatus;
  monthlyRentOrEmi: number;
  totalDebt: number;
  highestDebtRate: number;

  // Protection
  hasHealthInsurance: boolean;
  healthCoverAmount: number;
  hasTermInsurance: boolean;
  termCoverAmount: number;

  // Existing investments
  liquidSavings: number;
  equityValue: number;
  debtInvestmentValue: number;
  goldValue: number;
  existingMonthlySip: number;

  // Outlook
  selfRatedRisk: 1 | 2 | 3 | 4 | 5;
  marketDropReaction: MarketDropReaction;
  investmentHorizonYears: number;
  topPriority: GoalKind;
  taxBracket: 0 | 0.05 | 0.1 | 0.2 | 0.3;

  /** Keys the user actually answered. Everything else is running on a default. */
  answered: string[];
  /** Furthest step reached, so a half-finished interview resumes where it stopped. */
  lastStep: number;
  completedAt: number | null;
  /** Set when the user rejects the scored profile and picks their own. */
  riskProfileOverride: RiskProfile | null;
}

export const DEFAULT_INTERVIEW: InterviewProfile = {
  id: "singleton",
  age: 30,
  retirementAge: 60,
  dependents: 0,
  supportsParents: false,

  monthlyTakeHome: 0,
  otherMonthlyIncome: 0,
  incomeStability: "stable",
  expectedAnnualRaise: 0.08,

  housing: "rented",
  monthlyRentOrEmi: 0,
  totalDebt: 0,
  highestDebtRate: 0,

  hasHealthInsurance: false,
  healthCoverAmount: 0,
  hasTermInsurance: false,
  termCoverAmount: 0,

  liquidSavings: 0,
  equityValue: 0,
  debtInvestmentValue: 0,
  goldValue: 0,
  existingMonthlySip: 0,

  selfRatedRisk: 3,
  marketDropReaction: "hold",
  investmentHorizonYears: 10,
  topPriority: "emergency-fund",
  taxBracket: 0.2,

  answered: [],
  lastStep: 0,
  completedAt: null,
  riskProfileOverride: null,
};

export interface Settings {
  id: "singleton";
  currency: CurrencyCode;
  /** Liquid savings the user holds outside the imported statements. Feeds runway. */
  liquidSavings: number;
  emergencyFundMonths: number;
  /** Nominal annual return assumed for goals that do not override it. */
  defaultAnnualReturn: number;
  defaultInflationRate: number;
  notifications: {
    browserPush: boolean;
    emailDigest: boolean;
    /** Stored on this device only. Sent to the digest route at send time. */
    email: string;
    digestFrequency: "weekly" | "monthly";
    lastDigestSentAt: number | null;
  };
  onboardedAt: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "singleton",
  currency: "INR",
  liquidSavings: 0,
  emergencyFundMonths: 6,
  defaultAnnualReturn: 0.12,
  defaultInflationRate: 0.06,
  notifications: {
    browserPush: false,
    // Off by default and opt-in only: the digest is the single path by which
    // any financial data leaves this device.
    emailDigest: false,
    email: "",
    digestFrequency: "weekly",
    lastDigestSentAt: null,
  },
  onboardedAt: null,
};
