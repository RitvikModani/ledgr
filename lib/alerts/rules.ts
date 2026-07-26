import { NON_BUDGETABLE } from "@/lib/categorize/categories";
import {
  detectDuplicates,
  detectOutliers,
  detectRecurring,
  upcomingBills,
} from "@/lib/analytics/recurring";
import { median, runwayMonths, type FinancialSnapshot } from "@/lib/analytics/aggregate";
import { spendAgainstBudget } from "@/lib/planning/budget";
import { assessGoal } from "@/lib/planning/goals";
import { rebalanceActions } from "@/lib/invest/portfolio";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format/currency";
import {
  formatDate,
  monthKeyOf,
  monthProgress,
  relativeDayLabel,
  todayISO,
  type ISODate,
  type MonthKey,
} from "@/lib/format/date";
import type {
  Alert,
  AlertSeverity,
  Budget,
  Goal,
  InterviewProfile,
  Transaction,
} from "@/lib/db/types";
import type { AllocationRow } from "@/lib/invest/allocation";

export interface RuleContext {
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  interview: InterviewProfile;
  stats: FinancialSnapshot;
  allocationRows: AllocationRow[];
  bufferMonths: number;
  today: ISODate;
  currentMonth: MonthKey;
}

/** An alert before it has been stored: no id, no timestamps. */
export type DraftAlert = Omit<Alert, "id" | "createdAt">;

export type Rule = (context: RuleContext) => DraftAlert[];

/**
 * Every rule is a pure function from context to alerts.
 *
 * That shape is the whole design. It makes each rule independently testable at
 * its own boundary, keeps the thresholds in one readable place rather than
 * scattered through UI code, and means adding a rule cannot break an existing
 * one.
 *
 * `dedupeKey` identifies the *condition*, not the occurrence. Re-evaluating an
 * unchanged situation must produce the same key so the alert is not raised
 * twice — someone who opens the app four times in a day should not accumulate
 * four identical warnings.
 */

/* -------------------------------------------------------------------------- */

const budgetExceeded: Rule = ({ transactions, budgets, currentMonth }) => {
  const rows = spendAgainstBudget(transactions, budgets, currentMonth);

  return rows
    .filter((row) => row.limit > 0 && row.ratio >= 0.85)
    .map((row) => {
      const severity: AlertSeverity =
        row.ratio >= 1.25 ? "critical" : row.ratio >= 1 ? "serious" : "warning";

      return {
        kind: "budget-exceeded" as const,
        severity,
        title:
          row.ratio >= 1
            ? `${row.category} is over budget`
            : `${row.category} is nearly at its limit`,
        body:
          row.ratio >= 1
            ? `You have spent ${formatCurrency(row.spent)} against a ${formatCurrency(row.limit)} budget — ${formatCurrency(row.spent - row.limit)} over.`
            : `You have spent ${formatCurrency(row.spent)} of your ${formatCurrency(row.limit)} budget, with the month not finished.`,
        dedupeKey: `budget:${row.category}:${currentMonth}:${severity}`,
        href: "/plan",
        context: { category: row.category, spent: row.spent, limit: row.limit },
      };
    });
};

/**
 * Projects month-to-date spending to a full month.
 *
 * Only fires past the first week. Projecting from three days of data produces
 * wild numbers, and an alert that cries wolf every month on the 2nd is one the
 * user learns to ignore — which costs them the alerts that matter.
 */
const budgetPace: Rule = ({ transactions, budgets, currentMonth, today }) => {
  const progress = monthProgress(today);
  if (progress < 0.2) return [];

  const rows = spendAgainstBudget(transactions, budgets, currentMonth);

  return rows
    .filter((row) => {
      if (row.limit <= 0 || row.ratio >= 1) return false; // already handled above
      const projected = row.spent / progress;
      return projected > row.limit * 1.1;
    })
    .map((row) => {
      const projected = row.spent / progress;
      return {
        kind: "budget-pace" as const,
        severity: "warning" as AlertSeverity,
        title: `${row.category} is on pace to go over`,
        body: `At this rate you will spend about ${formatCurrency(projected)} this month against a ${formatCurrency(row.limit)} budget.`,
        dedupeKey: `pace:${row.category}:${currentMonth}`,
        href: "/plan",
        context: { category: row.category, projected: Math.round(projected), limit: row.limit },
      };
    });
};

const lowRunway: Rule = ({ interview, stats, bufferMonths }) => {
  const liquid = interview.liquidSavings;
  if (liquid <= 0 || stats.medianMonthlyExpense <= 0) return [];

  const months = runwayMonths(liquid, stats.medianMonthlyExpense);
  if (months >= 3) return [];

  const severity: AlertSeverity = months < 1 ? "critical" : "serious";

  return [
    {
      kind: "low-runway",
      severity,
      title:
        months < 1
          ? "Less than a month of expenses in reserve"
          : `About ${months.toFixed(1)} months of expenses in reserve`,
      body: `Your ${formatCompactCurrency(liquid)} would cover ${months.toFixed(1)} months at your usual spending. Your profile suggests aiming for ${bufferMonths}.`,
      dedupeKey: `runway:${severity}`,
      href: "/invest",
      context: { months: Number(months.toFixed(1)), target: bufferMonths },
    },
  ];
};

const goalOffTrack: Rule = ({ goals, currentMonth }) =>
  goals
    .map((goal) => ({ goal, assessment: assessGoal(goal, currentMonth) }))
    .filter(({ assessment }) =>
      ["off-track", "unfunded"].includes(assessment.status),
    )
    .map(({ goal, assessment }) => ({
      kind: "goal-off-track" as const,
      severity: (assessment.status === "unfunded" ? "serious" : "warning") as AlertSeverity,
      title:
        assessment.status === "unfunded"
          ? `"${goal.name}" has nothing going into it`
          : `"${goal.name}" is behind`,
      body:
        assessment.status === "unfunded"
          ? `Reaching ${formatCurrency(assessment.targetAtMaturity)} by ${formatDate(goal.targetDate)} would take ${formatCurrency(assessment.requiredMonthly)} a month.`
          : `You put in ${formatCurrency(goal.monthlyContribution)} a month; the date needs ${formatCurrency(assessment.requiredMonthly)}. Short by ${formatCurrency(assessment.monthlyShortfall)}.`,
      dedupeKey: `goal:${goal.id ?? goal.name}:${assessment.status}`,
      href: "/goals",
      context: {
        goal: goal.name,
        required: Math.round(assessment.requiredMonthly),
        shortfall: Math.round(assessment.monthlyShortfall),
      },
    }));

/**
 * Compares the most recent complete month's savings rate to the three before it.
 *
 * Against the trailing median rather than against the previous month alone: one
 * month with an annual insurance premium in it is not a trend, and alerting on
 * it teaches the user to dismiss the alert.
 */
const savingsRateDrop: Rule = ({ stats, currentMonth }) => {
  const complete = stats.months.filter((m) => m.month !== currentMonth);
  if (complete.length < 4) return [];

  const latest = complete.at(-1)!;
  const priorMonths = complete.slice(-4, -1);

  const rateOf = (m: (typeof complete)[number]) =>
    m.income === 0 ? 0 : (m.income - m.expense) / m.income;

  const latestRate = rateOf(latest);
  const priorRate = median(priorMonths.map(rateOf));

  if (priorRate <= 0 || latestRate >= priorRate - 0.1) return [];

  return [
    {
      kind: "savings-rate-drop",
      severity: "warning",
      title: "Your savings rate has fallen",
      body: `In ${latest.month} you saved ${formatPercent(latestRate, 0)} of what came in, against ${formatPercent(priorRate, 0)} across the three months before.`,
      dedupeKey: `savings-drop:${latest.month}`,
      href: "/",
      context: { month: latest.month, now: latestRate, before: priorRate },
    },
  ];
};

const outlierTransaction: Rule = ({ transactions, today }) => {
  // Only recent ones. Telling someone about an unusual charge from eight months
  // ago is trivia, not an alert.
  const recent = transactions.filter((t) => t.date >= addDays(today, -45));

  return detectOutliers(recent, 3)
    .slice(0, 5)
    .map((outlier) => ({
      kind: "outlier-transaction" as const,
      severity: "warning" as AlertSeverity,
      title: `Unusually large ${outlier.category.toLowerCase()} charge`,
      body: `${formatCurrency(Math.abs(outlier.transaction.amount))} at ${outlier.transaction.description.slice(0, 60)} on ${formatDate(outlier.transaction.date)}. You usually spend around ${formatCurrency(outlier.categoryTypical)} here.`,
      dedupeKey: `outlier:${outlier.transaction.hash}`,
      href: "/",
      context: {
        amount: Math.abs(outlier.transaction.amount),
        category: outlier.category,
        typical: Math.round(outlier.categoryTypical),
      },
    }));
};

const upcomingBill: Rule = ({ transactions, today }) => {
  const recurring = detectRecurring(transactions);

  return upcomingBills(recurring, 7, today).map((bill) => ({
    kind: "upcoming-bill" as const,
    severity: "good" as AlertSeverity,
    title: `${titleCase(bill.merchant)} is due ${relativeDayLabel(bill.nextExpected, today)}`,
    body: `About ${formatCurrency(bill.amount)}, based on ${bill.occurrences} previous payments.`,
    dedupeKey: `bill:${bill.merchant}:${bill.nextExpected}`,
    href: "/",
    context: { merchant: bill.merchant, amount: bill.amount, due: bill.nextExpected },
  }));
};

const recurringIncrease: Rule = ({ transactions }) =>
  detectRecurring(transactions)
    .filter((r) => r.increasedBy !== undefined)
    .map((r) => ({
      kind: "recurring-increase" as const,
      severity: "warning" as AlertSeverity,
      title: `${titleCase(r.merchant)} costs more than it used to`,
      body: `The latest charge was ${formatCurrency(r.increasedBy!)} higher than the ones before it — now about ${formatCurrency(r.amount + r.increasedBy!)} a time.`,
      dedupeKey: `increase:${r.merchant}:${r.lastDate}`,
      href: "/",
      context: { merchant: r.merchant, increase: Math.round(r.increasedBy!) },
    }));

const duplicateTransaction: Rule = ({ transactions, today }) => {
  const recent = transactions.filter((t) => t.date >= addDays(today, -60));

  return detectDuplicates(recent)
    .slice(0, 5)
    .map(({ a, b }) => ({
      kind: "duplicate-transaction" as const,
      severity: "warning" as AlertSeverity,
      title: "Possible double charge",
      body: `${formatCurrency(Math.abs(a.amount))} to ${a.description.slice(0, 50)} appears on both ${formatDate(a.date)} and ${formatDate(b.date)}.`,
      dedupeKey: `duplicate:${a.hash}:${b.hash}`,
      href: "/",
      context: { amount: Math.abs(a.amount), first: a.date, second: b.date },
    }));
};

const incomeDrop: Rule = ({ stats, currentMonth }) => {
  const complete = stats.months.filter((m) => m.month !== currentMonth);
  if (complete.length < 4) return [];

  const latest = complete.at(-1)!;
  const prior = median(complete.slice(-4, -1).map((m) => m.income));

  if (prior <= 0 || latest.income >= prior * 0.8) return [];

  return [
    {
      kind: "income-drop",
      severity: "serious",
      title: "Income was lower last month",
      body: `${formatCurrency(latest.income)} came in during ${latest.month}, against a usual ${formatCurrency(prior)}.`,
      dedupeKey: `income-drop:${latest.month}`,
      href: "/",
      context: { month: latest.month, income: latest.income, usual: prior },
    },
  ];
};

const allocationDrift: Rule = ({ allocationRows }) =>
  rebalanceActions(allocationRows).map((action) => ({
    kind: "allocation-drift" as const,
    severity: (Math.abs(action.driftShare) >= 0.15 ? "serious" : "warning") as AlertSeverity,
    title: `${action.label} is ${action.action === "sell" ? "over" : "under"} its target`,
    body: `${action.label} sits ${formatPercent(Math.abs(action.driftShare), 0)} away from target — about ${formatCurrency(action.amount)}. Directing new contributions there is cheaper than selling to rebalance.`,
    dedupeKey: `drift:${action.assetClass}:${action.driftShare >= 0 ? "over" : "under"}`,
    href: "/portfolio",
    context: { assetClass: action.assetClass, drift: action.driftShare },
  }));

const emergencyFundGap: Rule = ({ interview, stats, bufferMonths }) => {
  if (stats.medianMonthlyExpense <= 0) return [];

  const target = stats.medianMonthlyExpense * bufferMonths;
  const gap = target - interview.liquidSavings;
  // Under a fifth short is close enough not to nag about.
  if (gap <= target * 0.2) return [];

  return [
    {
      kind: "emergency-fund-gap",
      severity: "warning",
      title: "Your emergency fund is short",
      body: `Your profile points to ${bufferMonths} months of expenses — ${formatCurrency(target)}. You have ${formatCurrency(interview.liquidSavings)}, so about ${formatCurrency(gap)} to go.`,
      dedupeKey: "emergency-gap",
      href: "/invest",
      context: { target: Math.round(target), gap: Math.round(gap) },
    },
  ];
};

const highInterestDebt: Rule = ({ interview }) => {
  if (interview.totalDebt <= 0 || interview.highestDebtRate < 0.15) return [];

  return [
    {
      kind: "high-interest-debt",
      severity: interview.highestDebtRate >= 0.24 ? "critical" : "serious",
      title: `You are paying ${formatPercent(interview.highestDebtRate, 0)} on debt`,
      body: `Clearing ${formatCurrency(interview.totalDebt)} at that rate is a guaranteed return no investment reliably beats. It comes before adding to your SIPs.`,
      dedupeKey: `debt:${interview.highestDebtRate >= 0.24 ? "critical" : "serious"}`,
      href: "/invest",
      context: { debt: interview.totalDebt, rate: interview.highestDebtRate },
    },
  ];
};

const underinsured: Rule = ({ interview }) => {
  const alerts: DraftAlert[] = [];

  if (!interview.hasHealthInsurance) {
    alerts.push({
      kind: "underinsured",
      severity: "critical",
      title: "You have no health cover",
      body: "One hospital stay can undo years of saving. This is the single highest-value thing on your list.",
      dedupeKey: "underinsured:health",
      href: "/interview",
    });
  }

  if (interview.dependents > 0 && !interview.hasTermInsurance) {
    alerts.push({
      kind: "underinsured",
      severity: "serious",
      title: "No term cover, with people depending on you",
      body: `${interview.dependents} ${interview.dependents === 1 ? "person depends" : "people depend"} on your income. Term cover is inexpensive and this is exactly what it is for.`,
      dedupeKey: "underinsured:term",
      href: "/interview",
    });
  }

  return alerts;
};

export const RULES: Rule[] = [
  underinsured,
  highInterestDebt,
  lowRunway,
  budgetExceeded,
  budgetPace,
  goalOffTrack,
  emergencyFundGap,
  allocationDrift,
  savingsRateDrop,
  incomeDrop,
  recurringIncrease,
  outlierTransaction,
  duplicateTransaction,
  upcomingBill,
];

/* -------------------------------------------------------------------------- */

function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  serious: 1,
  warning: 2,
  good: 3,
};

/** Runs every rule and orders the result by how much it matters. */
export function evaluateRules(context: RuleContext): DraftAlert[] {
  const alerts = RULES.flatMap((rule) => {
    try {
      return rule(context);
    } catch {
      // One rule throwing must not take the whole alert centre down with it.
      return [];
    }
  });

  // Guard against two rules generating the same key — the DB's unique index
  // would reject the second insert and abort the batch.
  const seen = new Set<string>();
  const unique = alerts.filter((alert) => {
    if (seen.has(alert.dedupeKey)) return false;
    seen.add(alert.dedupeKey);
    return true;
  });

  return unique.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function defaultContext(
  partial: Partial<RuleContext> & Pick<RuleContext, "stats">,
): RuleContext {
  const today = partial.today ?? todayISO();
  return {
    transactions: [],
    budgets: [],
    goals: [],
    interview: partial.interview!,
    allocationRows: [],
    bufferMonths: 6,
    today,
    currentMonth: partial.currentMonth ?? monthKeyOf(today),
    ...partial,
  };
}

export { NON_BUDGETABLE };
