import { db } from "@/lib/db/db";
import { snapshot } from "@/lib/analytics/aggregate";
import { assessRisk, emergencyFundMonths } from "@/lib/interview/risk";
import { buildPlan } from "@/lib/invest/allocation";
import { summarisePortfolio } from "@/lib/invest/portfolio";
import { monthKeyOf, todayISO } from "@/lib/format/date";
import type { LedgrData } from "@/lib/hooks/useLedgrData";
import { evaluateRules, type DraftAlert, type RuleContext } from "./rules";

export interface EvaluationResult {
  created: number;
  /** Conditions that already had an open alert and were left alone. */
  unchanged: number;
  /** Alerts whose condition no longer holds, and which were cleared. */
  resolved: number;
}

/**
 * Builds rule context from stored data and re-evaluates every rule.
 *
 * Three behaviours matter here more than the evaluation itself:
 *
 *  - An unchanged condition does not produce a second alert. The unique
 *    `dedupeKey` index enforces it, so someone opening the app four times in a
 *    day does not accumulate four identical warnings.
 *  - A condition that has gone away has its alert removed rather than left to
 *    rot. An alert centre full of things the user already fixed is one they
 *    stop reading.
 *  - Acknowledged alerts stay acknowledged. Clearing and re-raising the same
 *    condition would be a nag loop.
 */
export async function evaluateAlerts(data: LedgrData): Promise<EvaluationResult> {
  const stats = snapshot(data.transactions);
  const risk = assessRisk(data.interview);
  const bufferMonths = emergencyFundMonths(data.interview);
  const portfolio = summarisePortfolio(data.holdings);

  const plan = buildPlan({
    profile: data.interview,
    risk: risk.profile,
    maxEquity: risk.maxEquity,
    horizonYears: Math.max(1, data.interview.investmentHorizonYears),
    monthlyInvestable: Math.max(0, stats.monthlySurplus),
    monthlyExpense: stats.medianMonthlyExpense,
    bufferMonths,
    expectedReturn: 0.12,
    currentByClass: data.holdings.length > 0 ? portfolio.byClass : undefined,
  });

  const today = todayISO();

  const context: RuleContext = {
    transactions: data.transactions,
    budgets: data.budgets,
    goals: data.goals,
    interview: data.interview,
    stats,
    // Drift is only meaningful against a portfolio that exists.
    allocationRows: data.holdings.length > 0 ? plan.rows : [],
    bufferMonths,
    today,
    currentMonth: monthKeyOf(today),
  };

  const drafts = evaluateRules(context);
  return reconcile(drafts);
}

/** Writes the difference between what the rules say now and what is stored. */
export async function reconcile(drafts: DraftAlert[]): Promise<EvaluationResult> {
  const table = db().alerts;
  const existing = await table.toArray();

  const currentKeys = new Set(drafts.map((d) => d.dedupeKey));
  const storedByKey = new Map(existing.map((a) => [a.dedupeKey, a]));

  let created = 0;
  let unchanged = 0;

  const toInsert = drafts
    .filter((draft) => {
      if (storedByKey.has(draft.dedupeKey)) {
        unchanged++;
        return false;
      }
      created++;
      return true;
    })
    .map((draft) => ({ ...draft, createdAt: Date.now() }));

  if (toInsert.length > 0) {
    try {
      await table.bulkAdd(toInsert);
    } catch (error) {
      // A concurrent evaluation may have inserted the same key. Individual
      // conflicts are fine; the batch still lands the rest.
      const failures = (error as { failures?: unknown[] }).failures?.length ?? 0;
      if (failures === 0) throw error;
      created -= failures;
    }
  }

  // Conditions that no longer hold. Acknowledged ones are removed too — the
  // user dealt with them, and keeping them serves nobody.
  const stale = existing.filter((alert) => !currentKeys.has(alert.dedupeKey));
  if (stale.length > 0) {
    await table.bulkDelete(stale.map((a) => a.id!).filter(Boolean));
  }

  return { created, unchanged, resolved: stale.length };
}
