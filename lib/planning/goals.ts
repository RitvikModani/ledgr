import {
  addMonths,
  monthKeyOf,
  monthKeyOfDate,
  monthsBetween,
  todayISO,
  type MonthKey,
} from "@/lib/format/date";
import type { Goal, GoalPriority } from "@/lib/db/types";

/* -------------------------------------------------------------------------- */
/* Money maths                                                                */
/* -------------------------------------------------------------------------- */

/** Monthly rate from a nominal annual rate, compounded monthly. */
export function monthlyRate(annualRate: number): number {
  return annualRate / 12;
}

/** What a lump sum grows to after `months` at `annualRate`. */
export function futureValue(
  present: number,
  annualRate: number,
  months: number,
): number {
  const r = monthlyRate(annualRate);
  return present * (1 + r) ** months;
}

/**
 * What a monthly contribution grows to — an ordinary annuity, contributions at
 * the end of each month.
 *
 * The zero-rate branch is not a rounding detail: the standard formula divides
 * by the rate, so a user who sets an expected return of 0% (entirely reasonable
 * for a savings-account goal) would otherwise get NaN through every downstream
 * projection.
 */
export function futureValueOfSeries(
  monthly: number,
  annualRate: number,
  months: number,
): number {
  if (months <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return monthly * months;
  return monthly * (((1 + r) ** months - 1) / r);
}

/**
 * The monthly contribution needed to close the gap between what a lump sum will
 * grow into and the target.
 */
export function requiredMonthly(
  target: number,
  present: number,
  annualRate: number,
  months: number,
): number {
  if (months <= 0) return Math.max(0, target - present);

  const grown = futureValue(present, annualRate, months);
  const gap = target - grown;
  if (gap <= 0) return 0;

  const r = monthlyRate(annualRate);
  if (r === 0) return gap / months;
  return gap / (((1 + r) ** months - 1) / r);
}

/**
 * Inflates a target to what it will actually cost on the target date.
 *
 * A ₹50 lakh house today is not a ₹50 lakh house in ten years. Planning against
 * the nominal figure is the most common way a long-horizon goal quietly fails —
 * the corpus arrives on time and buys two-thirds of what it was meant to.
 */
export function inflatedTarget(
  target: number,
  inflationRate: number,
  months: number,
): number {
  return target * (1 + inflationRate / 12) ** months;
}

/* -------------------------------------------------------------------------- */
/* Goal assessment                                                            */
/* -------------------------------------------------------------------------- */

export type GoalStatus = "achieved" | "on-track" | "at-risk" | "off-track" | "unfunded";

export interface GoalAssessment {
  goal: Goal;
  monthsRemaining: number;
  /** Target adjusted for inflation to the target date. */
  targetAtMaturity: number;
  /** What the current contribution actually gets to by then. */
  projected: number;
  /** What the contribution would need to be. */
  requiredMonthly: number;
  /** Positive means the current contribution is short by this much per month. */
  monthlyShortfall: number;
  /** Positive means the corpus falls short by this much at maturity. */
  shortfall: number;
  progress: number;
  status: GoalStatus;
  /** How far the goal would land past its date at the current contribution. */
  monthsLate: number | null;
}

const PRIORITY_WEIGHT: Record<GoalPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function assessGoal(goal: Goal, from: MonthKey = monthKeyOf(todayISO())): GoalAssessment {
  const monthsRemaining = Math.max(0, monthsBetween(from, monthKeyOf(goal.targetDate)));

  const targetAtMaturity = inflatedTarget(
    goal.targetAmount,
    goal.inflationRate,
    monthsRemaining,
  );

  const projected =
    futureValue(goal.currentAmount, goal.expectedAnnualReturn, monthsRemaining) +
    futureValueOfSeries(goal.monthlyContribution, goal.expectedAnnualReturn, monthsRemaining);

  const required = requiredMonthly(
    targetAtMaturity,
    goal.currentAmount,
    goal.expectedAnnualReturn,
    monthsRemaining,
  );

  const shortfall = Math.max(0, targetAtMaturity - projected);
  const monthlyShortfall = Math.max(0, required - goal.monthlyContribution);
  const progress = targetAtMaturity === 0 ? 1 : goal.currentAmount / targetAtMaturity;

  let status: GoalStatus;
  if (goal.currentAmount >= targetAtMaturity) status = "achieved";
  else if (goal.monthlyContribution <= 0 && required > 0) status = "unfunded";
  else if (projected >= targetAtMaturity) status = "on-track";
  else if (projected >= targetAtMaturity * 0.9) status = "at-risk";
  else status = "off-track";

  return {
    goal,
    monthsRemaining,
    targetAtMaturity,
    projected,
    requiredMonthly: required,
    monthlyShortfall,
    shortfall,
    progress: Math.min(1, Math.max(0, progress)),
    status,
    monthsLate: monthsToReach(goal, targetAtMaturity, monthsRemaining),
  };
}

/**
 * How many months past the target date the goal actually lands.
 *
 * Returns null when it is on time, and also when the contribution is so small
 * the goal never arrives — "1,200 months late" is not a useful thing to show
 * someone, so callers render that case as "never at this rate".
 */
function monthsToReach(
  goal: Goal,
  targetAtMaturity: number,
  monthsRemaining: number,
): number | null {
  if (goal.monthlyContribution <= 0) return null;

  const CEILING = 600; // fifty years
  for (let m = 0; m <= CEILING; m++) {
    const value =
      futureValue(goal.currentAmount, goal.expectedAnnualReturn, m) +
      futureValueOfSeries(goal.monthlyContribution, goal.expectedAnnualReturn, m);
    if (value >= targetAtMaturity) {
      return m <= monthsRemaining ? null : m - monthsRemaining;
    }
  }
  return null;
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  achieved: "Achieved",
  "on-track": "On track",
  "at-risk": "Nearly there",
  "off-track": "Off track",
  unfunded: "Not funded",
};

export const GOAL_STATUS_SEVERITY = {
  achieved: "good",
  "on-track": "good",
  "at-risk": "warning",
  "off-track": "serious",
  unfunded: "critical",
} as const;

/* -------------------------------------------------------------------------- */
/* Allocating a limited surplus                                               */
/* -------------------------------------------------------------------------- */

export interface GoalAllocation {
  goal: Goal;
  assessment: GoalAssessment;
  allocated: number;
  /** Positive when the surplus could not cover what this goal needs. */
  unmet: number;
}

export interface AllocationResult {
  allocations: GoalAllocation[];
  totalRequired: number;
  totalAllocated: number;
  leftOver: number;
  /** True when the surplus could not fund every goal. */
  constrained: boolean;
}

/**
 * Splits an available monthly surplus across goals.
 *
 * Fully funds goals in priority order rather than spreading the surplus thinly
 * across all of them. Partially funding five goals means missing five dates;
 * fully funding three means hitting three. Within a priority band, the nearer
 * deadline goes first, because a goal two years out has no time to recover from
 * being underfunded now and one twenty years out does.
 */
export function allocateSurplus(
  goals: Goal[],
  monthlySurplus: number,
  from: MonthKey = monthKeyOf(todayISO()),
): AllocationResult {
  const assessed = goals
    .map((goal) => ({ goal, assessment: assessGoal(goal, from) }))
    .sort((a, b) => {
      const weight = PRIORITY_WEIGHT[b.goal.priority] - PRIORITY_WEIGHT[a.goal.priority];
      if (weight !== 0) return weight;
      return a.assessment.monthsRemaining - b.assessment.monthsRemaining;
    });

  let remaining = Math.max(0, monthlySurplus);
  const allocations: GoalAllocation[] = [];
  let totalRequired = 0;

  for (const { goal, assessment } of assessed) {
    const need = assessment.requiredMonthly;
    totalRequired += need;

    const allocated = Math.min(need, remaining);
    remaining -= allocated;

    allocations.push({ goal, assessment, allocated, unmet: Math.max(0, need - allocated) });
  }

  const totalAllocated = allocations.reduce((sum, a) => sum + a.allocated, 0);

  return {
    allocations,
    totalRequired,
    totalAllocated,
    leftOver: remaining,
    constrained: totalRequired > monthlySurplus,
  };
}

/* -------------------------------------------------------------------------- */
/* Projection series                                                          */
/* -------------------------------------------------------------------------- */

export interface ProjectionOptions {
  startingAmount: number;
  monthlyContribution: number;
  annualReturn: number;
  months: number;
  /** Fractional annual increase applied to the contribution each year. */
  annualStepUp?: number;
  startMonth?: MonthKey;
}

export interface ProjectionRow {
  month: MonthKey;
  value: number;
  contributed: number;
}

/**
 * Month-by-month projection.
 *
 * Step-up matters more than it looks over a long horizon: a SIP frozen at
 * today's income for twenty years is a plan that shrinks in real terms every
 * year. Applying the user's expected raise annually is the difference between a
 * plausible projection and an optimistic one.
 */
export function project(options: ProjectionOptions): ProjectionRow[] {
  const {
    startingAmount,
    monthlyContribution,
    annualReturn,
    months,
    annualStepUp = 0,
    startMonth = monthKeyOfDate(new Date()),
  } = options;

  const r = monthlyRate(annualReturn);
  const rows: ProjectionRow[] = [];

  let value = startingAmount;
  let contributed = startingAmount;
  let contribution = monthlyContribution;

  for (let m = 0; m <= months; m++) {
    if (m > 0) {
      if (m % 12 === 0 && annualStepUp > 0) {
        contribution *= 1 + annualStepUp;
      }
      value = value * (1 + r) + contribution;
      contributed += contribution;
    }
    rows.push({ month: addMonths(startMonth, m), value, contributed });
  }

  return rows;
}
