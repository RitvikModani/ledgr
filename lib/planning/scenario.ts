import { monthKeyOf, todayISO, type MonthKey } from "@/lib/format/date";
import type { Goal, Scenario } from "@/lib/db/types";
import { allocateSurplus, assessGoal, project, type ProjectionRow } from "./goals";

export const EMPTY_SCENARIO: Omit<Scenario, "id" | "name" | "createdAt"> = {
  incomeChangePct: 0,
  extraMonthlyContribution: 0,
  returnRateOverride: null,
  targetDateShiftMonths: 0,
  categoryCuts: {},
};

export interface ScenarioInput {
  monthlyIncome: number;
  monthlyExpense: number;
  /** Spend per category, used so a per-category cut has something to cut from. */
  categorySpend: Record<string, number>;
  goals: Goal[];
}

export interface ScenarioOutcome {
  monthlyIncome: number;
  monthlyExpense: number;
  monthlySurplus: number;
  savingsRate: number;
  /** Total corpus across all goals at the end of the projection. */
  corpusAtHorizon: number;
  goalsOnTrack: number;
  totalGoals: number;
  projection: ProjectionRow[];
  horizonMonths: number;
}

/**
 * Runs the numbers under a set of what-if changes.
 *
 * The same function computes the baseline, by being handed an empty scenario.
 * That matters: if the baseline came from a separate code path, the two could
 * diverge and the comparison — which is the entire point of the page — would be
 * between two different models rather than between two situations.
 */
export function runScenario(
  input: ScenarioInput,
  scenario: Omit<Scenario, "id" | "name" | "createdAt">,
  from: MonthKey = monthKeyOf(todayISO()),
): ScenarioOutcome {
  const monthlyIncome = input.monthlyIncome * (1 + scenario.incomeChangePct);

  // Cuts apply per category, so trimming dining by 30% takes 30% of dining and
  // not 30% of everything.
  let saved = 0;
  for (const [category, cut] of Object.entries(scenario.categoryCuts)) {
    saved += (input.categorySpend[category] ?? 0) * cut;
  }
  const monthlyExpense = Math.max(0, input.monthlyExpense - saved);

  const monthlySurplus = monthlyIncome - monthlyExpense;

  const goals = input.goals.map((goal) => ({
    ...goal,
    targetDate: shiftDate(goal.targetDate, scenario.targetDateShiftMonths),
    expectedAnnualReturn: scenario.returnRateOverride ?? goal.expectedAnnualReturn,
  }));

  const allocation = allocateSurplus(goals, monthlySurplus, from);

  const horizonMonths = Math.max(
    12,
    ...allocation.allocations.map((a) => a.assessment.monthsRemaining),
  );

  const totalCurrent = goals.reduce((sum, g) => sum + g.currentAmount, 0);
  const avgReturn =
    goals.length === 0
      ? (scenario.returnRateOverride ?? 0.12)
      : goals.reduce((sum, g) => sum + g.expectedAnnualReturn, 0) / goals.length;

  // Everything the surplus can actually fund, plus whatever extra the user is
  // modelling putting in on top.
  const contribution =
    Math.min(monthlySurplus, allocation.totalRequired) + scenario.extraMonthlyContribution;

  const projection = project({
    startingAmount: totalCurrent,
    monthlyContribution: Math.max(0, contribution),
    annualReturn: avgReturn,
    months: horizonMonths,
    startMonth: from,
  });

  const goalsOnTrack = goals.filter((goal) => {
    const withExtra = {
      ...goal,
      monthlyContribution:
        goal.monthlyContribution +
        (allocation.allocations.find((a) => a.goal.name === goal.name)?.allocated ?? 0),
    };
    const status = assessGoal(withExtra, from).status;
    return status === "on-track" || status === "achieved";
  }).length;

  return {
    monthlyIncome,
    monthlyExpense,
    monthlySurplus,
    savingsRate: monthlyIncome === 0 ? 0 : monthlySurplus / monthlyIncome,
    corpusAtHorizon: projection.at(-1)?.value ?? 0,
    goalsOnTrack,
    totalGoals: goals.length,
    projection,
    horizonMonths,
  };
}

function shiftDate(date: string, months: number): string {
  if (months === 0) return date;
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface ScenarioComparison {
  baseline: ScenarioOutcome;
  scenario: ScenarioOutcome;
  surplusDelta: number;
  corpusDelta: number;
  goalsDelta: number;
  /** Months earlier the scenario reaches the baseline's final corpus. Null if it never does. */
  monthsEarlier: number | null;
}

export function compareScenario(
  input: ScenarioInput,
  scenario: Omit<Scenario, "id" | "name" | "createdAt">,
  from: MonthKey = monthKeyOf(todayISO()),
): ScenarioComparison {
  const baseline = runScenario(input, EMPTY_SCENARIO, from);
  const modified = runScenario(input, scenario, from);

  // "How much sooner does this get me to where I was going to end up?" is the
  // question people actually ask, and it is more legible than a corpus delta.
  const target = baseline.corpusAtHorizon;
  let monthsEarlier: number | null = null;
  if (target > 0) {
    const index = modified.projection.findIndex((row) => row.value >= target);
    if (index >= 0 && index < baseline.projection.length - 1) {
      monthsEarlier = baseline.projection.length - 1 - index;
    }
  }

  return {
    baseline,
    scenario: modified,
    surplusDelta: modified.monthlySurplus - baseline.monthlySurplus,
    corpusDelta: modified.corpusAtHorizon - baseline.corpusAtHorizon,
    goalsDelta: modified.goalsOnTrack - baseline.goalsOnTrack,
    monthsEarlier: monthsEarlier && monthsEarlier > 0 ? monthsEarlier : null,
  };
}
