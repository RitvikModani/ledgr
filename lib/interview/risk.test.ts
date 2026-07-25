import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVIEW, type InterviewProfile } from "@/lib/db/types";
import {
  assessRisk,
  emergencyFundMonths,
  recommendedHealthCover,
  recommendedTermCover,
} from "./risk";

function profile(overrides: Partial<InterviewProfile> = {}): InterviewProfile {
  return { ...DEFAULT_INTERVIEW, ...overrides };
}

describe("assessRisk scoring", () => {
  it("scores a long-horizon, steady-income holder as aggressive", () => {
    const result = assessRisk(
      profile({
        age: 28,
        retirementAge: 60,
        marketDropReaction: "buy-more",
        incomeStability: "very-stable",
        selfRatedRisk: 5,
        investmentHorizonYears: 25,
        liquidSavings: 600000,
        monthlyRentOrEmi: 30000,
      }),
    );

    expect(result.scoredProfile).toBe("aggressive");
    expect(result.profile).toBe("aggressive");
    expect(result.caps).toHaveLength(0);
  });

  it("scores a panic-seller as conservative even on a long horizon", () => {
    const result = assessRisk(
      profile({
        age: 30,
        marketDropReaction: "sell-all",
        incomeStability: "irregular",
        selfRatedRisk: 1,
        investmentHorizonYears: 20,
        liquidSavings: 100000,
      }),
    );

    expect(result.scoredProfile).toBe("conservative");
  });

  it("weights behaviour above stated appetite", () => {
    const saysAggressive = assessRisk(
      profile({ selfRatedRisk: 5, marketDropReaction: "sell-all", investmentHorizonYears: 20 }),
    );
    const saysCautious = assessRisk(
      profile({ selfRatedRisk: 1, marketDropReaction: "buy-more", investmentHorizonYears: 20 }),
    );

    // Someone who says "adventurous" but sells in a crash is the more cautious
    // investor of the two, whatever the label they picked.
    expect(saysCautious.score).toBeGreaterThan(saysAggressive.score);
  });
});

describe("assessRisk caps", () => {
  it("caps a short horizon to conservative however adventurous the answers", () => {
    const result = assessRisk(
      profile({
        age: 30,
        marketDropReaction: "buy-more",
        incomeStability: "very-stable",
        selfRatedRisk: 5,
        investmentHorizonYears: 2,
      }),
    );

    expect(result.scoredProfile).not.toBe("conservative");
    expect(result.profile).toBe("conservative");
    expect(result.caps.join(" ")).toContain("2 year");
  });

  it("caps a near-retirement saver to conservative", () => {
    const result = assessRisk(
      profile({
        age: 58,
        retirementAge: 60,
        marketDropReaction: "buy-more",
        incomeStability: "very-stable",
        selfRatedRisk: 5,
        investmentHorizonYears: 20,
      }),
    );

    expect(result.profile).toBe("conservative");
    expect(result.caps.join(" ")).toContain("retirement");
  });

  it("caps mid-horizon answers to moderate", () => {
    const result = assessRisk(
      profile({
        age: 35,
        retirementAge: 60,
        marketDropReaction: "buy-more",
        incomeStability: "very-stable",
        selfRatedRisk: 5,
        investmentHorizonYears: 5,
      }),
    );

    expect(result.profile).toBe("moderate");
  });

  it("caps for expensive debt", () => {
    const result = assessRisk(
      profile({
        age: 30,
        marketDropReaction: "buy-more",
        incomeStability: "very-stable",
        selfRatedRisk: 5,
        investmentHorizonYears: 20,
        totalDebt: 400000,
        highestDebtRate: 0.38,
      }),
    );

    expect(result.profile).toBe("moderate");
    expect(result.caps.join(" ")).toContain("38%");
  });

  it("reports no caps when none of them bind", () => {
    // A conservative scorer with a short horizon is already conservative, so
    // the horizon cap changed nothing and should not be reported as a reason.
    const result = assessRisk(
      profile({
        marketDropReaction: "sell-all",
        selfRatedRisk: 1,
        incomeStability: "irregular",
        investmentHorizonYears: 2,
      }),
    );

    expect(result.profile).toBe("conservative");
    expect(result.caps).toHaveLength(0);
  });

  it("honours an explicit override and says so", () => {
    const result = assessRisk(
      profile({ investmentHorizonYears: 2, riskProfileOverride: "aggressive" }),
    );

    expect(result.profile).toBe("aggressive");
    expect(result.overridden).toBe(true);
  });

  it("ties the equity ceiling to the final profile", () => {
    expect(assessRisk(profile({ riskProfileOverride: "conservative" })).maxEquity).toBe(0.35);
    expect(assessRisk(profile({ riskProfileOverride: "aggressive" })).maxEquity).toBe(0.8);
  });
});

describe("emergencyFundMonths", () => {
  it("starts at six months and adjusts for how replaceable the income is", () => {
    const insured = { hasHealthInsurance: true } as const;
    expect(emergencyFundMonths(profile({ ...insured, incomeStability: "stable" }))).toBe(6);
    expect(emergencyFundMonths(profile({ ...insured, incomeStability: "very-stable" }))).toBe(5);
    expect(emergencyFundMonths(profile({ ...insured, incomeStability: "irregular" }))).toBe(9);
  });

  it("adds two months when there is no health cover", () => {
    // An uninsured medical event is the single most common way a plan fails,
    // so the buffer has to absorb one.
    expect(emergencyFundMonths(profile({ hasHealthInsurance: false }))).toBe(8);
    expect(emergencyFundMonths(profile({ hasHealthInsurance: true }))).toBe(6);
  });

  it("deepens the buffer for dependents and missing health cover", () => {
    expect(
      emergencyFundMonths(
        profile({ dependents: 3, supportsParents: true, hasHealthInsurance: false }),
      ),
    ).toBe(11);
  });

  it("stays inside three to twelve months", () => {
    const most = emergencyFundMonths(
      profile({
        incomeStability: "irregular",
        dependents: 6,
        supportsParents: true,
        hasHealthInsurance: false,
      }),
    );
    expect(most).toBeLessThanOrEqual(12);
    expect(most).toBeGreaterThanOrEqual(3);
  });
});

describe("insurance recommendations", () => {
  it("recommends no term cover when nobody depends on the income", () => {
    // Telling a single person with no dependents to buy life insurance is
    // selling, not planning.
    expect(recommendedTermCover(profile({ dependents: 0, supportsParents: false }))).toBe(0);
  });

  it("recommends ten years of income plus debt when there are dependents", () => {
    const cover = recommendedTermCover(
      profile({ dependents: 2, monthlyTakeHome: 100000, totalDebt: 2000000 }),
    );
    // 1.2Cr income x 10 = 12Cr... no: 12L a year x 10 = 1.2Cr, plus 20L debt.
    expect(cover).toBe(14000000);
  });

  it("scales health cover with dependents and parents", () => {
    expect(recommendedHealthCover(profile({ dependents: 0 }))).toBe(500000);
    expect(
      recommendedHealthCover(profile({ dependents: 2, supportsParents: true })),
    ).toBeGreaterThan(1000000);
  });
});
