import type { InterviewProfile, RiskProfile } from "@/lib/db/types";

export interface RiskAssessment {
  profile: RiskProfile;
  /** 0..100 behavioural score, before any caps. */
  score: number;
  /** What the score alone would have said. */
  scoredProfile: RiskProfile;
  /** Reasons the score was capped down, in plain language. Empty when uncapped. */
  caps: string[];
  /** True when the user overrode the assessment by hand. */
  overridden: boolean;
  /** Maximum equity share this assessment permits, 0..1. */
  maxEquity: number;
}

const REACTION_POINTS: Record<InterviewProfile["marketDropReaction"], number> = {
  // What someone did last time predicts a plan's survival better than what they
  // say their appetite is, so this carries the most weight.
  "sell-all": 0,
  "sell-some": 10,
  hold: 26,
  "buy-more": 34,
};

const STABILITY_POINTS: Record<InterviewProfile["incomeStability"], number> = {
  "very-stable": 20,
  stable: 16,
  variable: 8,
  irregular: 2,
};

/**
 * Scores risk tolerance, then caps it by circumstance.
 *
 * The cap is the important half. A questionnaire alone will happily hand an
 * 80% equity allocation to a 58-year-old saving for a house purchase in three
 * years, because they answered "adventurous" — and they may well be
 * adventurous, but the money still has to exist in three years. Temperament
 * sets the ceiling you are comfortable with; horizon and age set the ceiling
 * that is survivable, and the plan uses the lower of the two.
 *
 * Every cap that binds is reported, so the user is told why their answers did
 * not produce the allocation they expected rather than silently overruled.
 */
export function assessRisk(profile: InterviewProfile): RiskAssessment {
  let score = 0;

  score += REACTION_POINTS[profile.marketDropReaction] ?? 18;
  score += STABILITY_POINTS[profile.incomeStability] ?? 12;

  // Stated appetite: real signal, but deliberately worth less than behaviour.
  score += ((profile.selfRatedRisk ?? 3) - 1) * 5; // 0..20

  // Horizon.
  const horizon = profile.investmentHorizonYears ?? 10;
  if (horizon >= 15) score += 20;
  else if (horizon >= 10) score += 16;
  else if (horizon >= 7) score += 11;
  else if (horizon >= 5) score += 6;
  else if (horizon >= 3) score += 2;

  // An emergency buffer is what lets someone hold through a drawdown without
  // being forced to sell, so it belongs in the risk score rather than beside it.
  const monthlyOutgo = profile.monthlyRentOrEmi > 0 ? profile.monthlyRentOrEmi * 2 : 30000;
  const bufferMonths = monthlyOutgo > 0 ? profile.liquidSavings / monthlyOutgo : 0;
  if (bufferMonths >= 6) score += 6;
  else if (bufferMonths >= 3) score += 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const scoredProfile: RiskProfile =
    score >= 62 ? "aggressive" : score >= 38 ? "moderate" : "conservative";

  /* ---------------------------------------------------------------------- */
  /* Caps                                                                    */
  /* ---------------------------------------------------------------------- */

  const caps: string[] = [];
  let ceiling: RiskProfile = "aggressive";

  function capTo(level: RiskProfile, reason: string) {
    const order: RiskProfile[] = ["conservative", "moderate", "aggressive"];
    if (order.indexOf(level) < order.indexOf(ceiling)) {
      ceiling = level;
    }
    // Only reported if it actually binds — see the filter below.
    caps.push(reason);
  }

  const pending: Array<{ level: RiskProfile; reason: string }> = [];

  if (horizon < 3) {
    pending.push({
      level: "conservative",
      reason: `Money you need within ${horizon} year${horizon === 1 ? "" : "s"} should not depend on the market recovering in time.`,
    });
  } else if (horizon < 7) {
    pending.push({
      level: "moderate",
      reason: `A ${horizon}-year horizon is not long enough to ride out a bad run in a mostly-equity portfolio.`,
    });
  }

  const yearsToRetirement = Math.max(0, profile.retirementAge - profile.age);
  if (yearsToRetirement <= 5) {
    pending.push({
      level: "conservative",
      reason: `With ${yearsToRetirement} year${yearsToRetirement === 1 ? "" : "s"} to retirement, a large drawdown would leave no time to recover.`,
    });
  } else if (yearsToRetirement <= 12) {
    pending.push({
      level: "moderate",
      reason: `${yearsToRetirement} years to retirement is enough for equity, but not for a maximum-equity allocation.`,
    });
  }

  if (profile.incomeStability === "irregular" && profile.liquidSavings <= 0) {
    pending.push({
      level: "conservative",
      reason:
        "Irregular income with no cash buffer means a bad month could force you to sell at the worst time.",
    });
  }

  if (profile.highestDebtRate >= 0.15 && profile.totalDebt > 0) {
    pending.push({
      level: "moderate",
      reason: `Clearing debt at ${(profile.highestDebtRate * 100).toFixed(0)}% is a guaranteed return that beats what the market is likely to give you.`,
    });
  }

  caps.length = 0;
  for (const item of pending) capTo(item.level, item.reason);

  const order: RiskProfile[] = ["conservative", "moderate", "aggressive"];
  const capped: RiskProfile =
    order.indexOf(scoredProfile) > order.indexOf(ceiling) ? ceiling : scoredProfile;

  // Report only the caps that actually lowered the outcome.
  const bindingCaps =
    capped === scoredProfile
      ? []
      : pending
          .filter((item) => order.indexOf(item.level) <= order.indexOf(capped))
          .map((item) => item.reason);

  const overridden = profile.riskProfileOverride !== null;
  const profileFinal = profile.riskProfileOverride ?? capped;

  return {
    profile: profileFinal,
    score,
    scoredProfile,
    caps: bindingCaps,
    overridden,
    maxEquity: MAX_EQUITY[profileFinal],
  };
}

const MAX_EQUITY: Record<RiskProfile, number> = {
  conservative: 0.35,
  moderate: 0.6,
  aggressive: 0.8,
};

export const RISK_LABEL: Record<RiskProfile, string> = {
  conservative: "Conservative",
  moderate: "Moderate",
  aggressive: "Aggressive",
};

export const RISK_DESCRIPTION: Record<RiskProfile, string> = {
  conservative:
    "Capital preservation first. Most of the portfolio in debt and cash, enough equity to stay ahead of inflation.",
  moderate:
    "A balance. Enough equity to grow meaningfully, enough debt that a bad year is uncomfortable rather than ruinous.",
  aggressive:
    "Growth first. Mostly equity, on the understanding that a 30–40% drawdown is a normal event you will hold through.",
};

/**
 * How many months of expenses the emergency fund should hold.
 *
 * Six months is the usual rule of thumb, but the rule is really about how long
 * it would take to replace the income — so irregular earners and people with
 * dependents get more, and a very secure single earner needs less.
 */
export function emergencyFundMonths(profile: InterviewProfile): number {
  let months = 6;

  if (profile.incomeStability === "irregular") months += 3;
  else if (profile.incomeStability === "variable") months += 1;
  else if (profile.incomeStability === "very-stable") months -= 1;

  if (profile.dependents > 0) months += 1;
  if (profile.dependents >= 3) months += 1;
  if (profile.supportsParents) months += 1;
  if (!profile.hasHealthInsurance) months += 2;

  return Math.max(3, Math.min(12, months));
}

/**
 * Recommended term-life cover: roughly ten years of income plus outstanding
 * debt, so dependents are not left with both the loss and the loan.
 *
 * Zero when nobody depends on the income — a single person with no dependents
 * does not need life cover, and telling them otherwise is selling, not planning.
 */
export function recommendedTermCover(profile: InterviewProfile): number {
  if (profile.dependents === 0 && !profile.supportsParents) return 0;
  const annualIncome = (profile.monthlyTakeHome + profile.otherMonthlyIncome) * 12;
  return Math.round((annualIncome * 10 + profile.totalDebt) / 100000) * 100000;
}

/**
 * Recommended health cover. Deliberately blunt — a floor plus a step per
 * dependent, rounded to the sums insurers actually sell.
 */
export function recommendedHealthCover(profile: InterviewProfile): number {
  const base = 500000;
  const perDependent = 250000;
  const parents = profile.supportsParents ? 500000 : 0;
  const raw = base + profile.dependents * perDependent + parents;
  return Math.max(500000, Math.round(raw / 500000) * 500000);
}
