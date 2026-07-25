import type { InterviewProfile } from "@/lib/db/types";

export type QuestionKey = keyof InterviewProfile;

export type Question =
  | {
      kind: "currency";
      key: QuestionKey;
      label: string;
      help?: string;
      why: string;
      placeholder?: string;
    }
  | {
      kind: "number";
      key: QuestionKey;
      label: string;
      help?: string;
      why: string;
      min: number;
      max: number;
      suffix?: string;
    }
  | {
      kind: "percent";
      key: QuestionKey;
      label: string;
      help?: string;
      why: string;
      min: number;
      max: number;
      step: number;
    }
  | {
      kind: "choice";
      key: QuestionKey;
      label: string;
      help?: string;
      why: string;
      options: Array<{ value: string | number; label: string; hint?: string }>;
      columns?: 1 | 2;
    }
  | {
      kind: "boolean";
      key: QuestionKey;
      label: string;
      help?: string;
      why: string;
    };

export interface InterviewStep {
  id: string;
  title: string;
  lede: string;
  questions: Question[];
}

/**
 * The fact-find.
 *
 * Every question carries a `why`. A 25-question form asking about someone's
 * money without saying what each answer is for is an interrogation; saying
 * "this sets your emergency fund target" turns it into a conversation. It also
 * keeps the form honest — a question with no articulable use should be cut, and
 * several were.
 *
 * Nothing here is required. Every field has a working default, so the plan is
 * computable from an empty profile and simply says which numbers it assumed.
 */
export const INTERVIEW_STEPS: InterviewStep[] = [
  {
    id: "about-you",
    title: "About you",
    lede: "Four questions that set the shape of everything else — how long your money has to last, and who depends on it.",
    questions: [
      {
        kind: "number",
        key: "age",
        label: "How old are you?",
        why: "Caps how much equity risk the plan will put in front of you, and sets the retirement horizon.",
        min: 16,
        max: 90,
        suffix: "years",
      },
      {
        kind: "number",
        key: "retirementAge",
        label: "When would you like to stop working?",
        why: "The number of years left to build a retirement corpus, and when the glide path starts de-risking.",
        min: 35,
        max: 85,
        suffix: "years old",
      },
      {
        kind: "number",
        key: "dependents",
        label: "How many people depend on your income?",
        help: "Partner, children, anyone whose bills you cover.",
        why: "Drives the term-insurance cover check and pushes the emergency fund target up.",
        min: 0,
        max: 12,
        suffix: "people",
      },
      {
        kind: "boolean",
        key: "supportsParents",
        label: "Do you support your parents financially?",
        why: "Adds a health-cover requirement the plan would otherwise miss, and lengthens the emergency buffer.",
      },
    ],
  },
  {
    id: "income",
    title: "What comes in",
    lede: "Ledgr can see income in your statement, but not how reliable it is. That difference matters more than the amount.",
    questions: [
      {
        kind: "currency",
        key: "monthlyTakeHome",
        label: "Monthly take-home pay",
        help: "After tax and deductions. Leave blank to use what your statement shows.",
        why: "The base for every budget envelope and SIP amount.",
        placeholder: "80000",
      },
      {
        kind: "currency",
        key: "otherMonthlyIncome",
        label: "Any other monthly income",
        help: "Rent received, freelance work, dividends.",
        why: "Counted toward surplus, but treated as less reliable than salary.",
      },
      {
        kind: "choice",
        key: "incomeStability",
        label: "How steady is that income?",
        why: "Sets how many months of expenses your emergency fund should hold — irregular income needs a deeper buffer, and it caps the risk score.",
        options: [
          { value: "very-stable", label: "Very steady", hint: "Government or tenured role" },
          { value: "stable", label: "Steady", hint: "Salaried, secure" },
          { value: "variable", label: "Varies", hint: "Commission, bonus-heavy" },
          { value: "irregular", label: "Irregular", hint: "Freelance, business" },
        ],
      },
      {
        kind: "percent",
        key: "expectedAnnualRaise",
        label: "Expected annual pay rise",
        why: "Lets the plan step up your SIPs each year instead of freezing them at today's income.",
        min: 0,
        max: 0.3,
        step: 0.01,
      },
    ],
  },
  {
    id: "obligations",
    title: "What is already committed",
    lede: "Money that is spoken for before you decide anything. Debt above about 10% interest changes the whole order of operations.",
    questions: [
      {
        kind: "choice",
        key: "housing",
        label: "Where do you live?",
        why: "Rent is an expense the plan protects; a home loan is debt it schedules around.",
        options: [
          { value: "rented", label: "Rented" },
          { value: "owned-with-loan", label: "Own it, with a loan" },
          { value: "owned-outright", label: "Own it outright" },
          { value: "family-home", label: "Family home" },
        ],
      },
      {
        kind: "currency",
        key: "monthlyRentOrEmi",
        label: "Monthly rent or home-loan EMI",
        why: "The largest fixed line in most budgets, and the one the emergency fund has to cover.",
      },
      {
        kind: "currency",
        key: "totalDebt",
        label: "Total debt outstanding",
        help: "Card balances, personal loans, car loan, home loan.",
        why: "Debt above roughly 10% interest beats almost any investment return, so the plan clears it first.",
      },
      {
        kind: "percent",
        key: "highestDebtRate",
        label: "Highest interest rate you are paying",
        help: "Credit card revolving balances are usually 36–42% a year.",
        why: "Compared against your expected investment return to decide what to pay down before investing.",
        min: 0,
        max: 0.45,
        step: 0.005,
      },
    ],
  },
  {
    id: "protection",
    title: "What happens if something goes wrong",
    lede: "The least interesting part of a financial plan and the part that most often makes the difference. One hospital stay undoes a decade of SIPs.",
    questions: [
      {
        kind: "boolean",
        key: "hasHealthInsurance",
        label: "Do you have health insurance?",
        why: "An uninsured medical event is the most common reason a plan fails, so this outranks investing.",
      },
      {
        kind: "currency",
        key: "healthCoverAmount",
        label: "How much health cover?",
        help: "Total sum insured across all policies.",
        why: "Checked against a rule of thumb for your city and dependents.",
      },
      {
        kind: "boolean",
        key: "hasTermInsurance",
        label: "Do you have term life insurance?",
        why: "Only matters if someone depends on your income — the plan will not nag you about it if nobody does.",
      },
      {
        kind: "currency",
        key: "termCoverAmount",
        label: "How much term cover?",
        why: "Compared against roughly ten times your annual income plus outstanding debt.",
      },
    ],
  },
  {
    id: "investments",
    title: "What you already hold",
    lede: "Your starting point. Without it, the plan would tell you to build things you have already built.",
    questions: [
      {
        kind: "currency",
        key: "liquidSavings",
        label: "Cash in bank and fixed deposits",
        why: "Your runway, and the first place the emergency fund is drawn from.",
      },
      {
        kind: "currency",
        key: "equityValue",
        label: "Equity — stocks and equity mutual funds",
        why: "Counted toward your target allocation, so the plan does not tell you to buy what you own.",
      },
      {
        kind: "currency",
        key: "debtInvestmentValue",
        label: "Debt — PPF, EPF, NPS, bonds, debt funds",
        why: "Usually the largest holding people forget to count. EPF alone often covers the whole debt allocation.",
      },
      {
        kind: "currency",
        key: "goldValue",
        label: "Gold — jewellery, ETFs, sovereign gold bonds",
        why: "Counted toward the gold allocation, which is otherwise easy to over-buy.",
      },
      {
        kind: "currency",
        key: "existingMonthlySip",
        label: "Monthly SIPs you already run",
        why: "Deducted from what the plan asks you to invest, so the numbers are what changes, not what you already do.",
      },
    ],
  },
  {
    id: "outlook",
    title: "How you think about risk",
    lede: "Not what you say you can tolerate — what you actually did last time. These answers set the equity share.",
    questions: [
      {
        kind: "choice",
        key: "marketDropReaction",
        label: "Your portfolio drops 30% in a month. What do you do?",
        help: "This has happened three times in the last twenty years.",
        why: "The strongest single predictor of whether a plan survives a bad year. Weighted more heavily than what you say your risk appetite is.",
        columns: 1,
        options: [
          { value: "sell-all", label: "Sell everything and stop the bleeding" },
          { value: "sell-some", label: "Sell some, wait it out" },
          { value: "hold", label: "Hold, keep the SIPs running" },
          { value: "buy-more", label: "Buy more while it is cheap" },
        ],
      },
      {
        kind: "choice",
        key: "selfRatedRisk",
        label: "How would you describe your appetite for risk?",
        why: "Your stated preference. Counted, but not allowed to override your horizon or your age.",
        options: [
          { value: 1, label: "Very cautious" },
          { value: 2, label: "Cautious" },
          { value: 3, label: "Balanced" },
          { value: 4, label: "Adventurous" },
          { value: 5, label: "Very adventurous" },
        ],
      },
      {
        kind: "number",
        key: "investmentHorizonYears",
        label: "How long before you need this money?",
        why: "Caps equity regardless of appetite. Money needed in three years does not belong in the market, whatever your temperament.",
        min: 1,
        max: 40,
        suffix: "years",
      },
      {
        kind: "choice",
        key: "topPriority",
        label: "What matters most right now?",
        why: "Decides which goal gets funded first when the surplus cannot cover everything.",
        options: [
          { value: "emergency-fund", label: "Building a safety net" },
          { value: "debt-payoff", label: "Getting out of debt" },
          { value: "home", label: "Buying a home" },
          { value: "retirement", label: "Retiring comfortably" },
          { value: "education", label: "Education — mine or my children's" },
          { value: "travel", label: "Travel and experiences" },
        ],
      },
      {
        kind: "choice",
        key: "taxBracket",
        label: "Your income tax slab",
        why: "Decides whether tax-sheltered instruments like ELSS, PPF and NPS are worth suggesting at all.",
        options: [
          { value: 0, label: "No tax" },
          { value: 0.05, label: "5%" },
          { value: 0.1, label: "10%" },
          { value: 0.2, label: "20%" },
          { value: 0.3, label: "30%" },
        ],
      },
    ],
  },
];

export const TOTAL_QUESTIONS = INTERVIEW_STEPS.reduce(
  (sum, step) => sum + step.questions.length,
  0,
);

export function questionByKey(key: string): Question | undefined {
  for (const step of INTERVIEW_STEPS) {
    const found = step.questions.find((q) => q.key === key);
    if (found) return found;
  }
  return undefined;
}

/** Which step a question lives on, so "sharpen this" links can deep-link to it. */
export function stepIndexForKey(key: string): number {
  return INTERVIEW_STEPS.findIndex((step) => step.questions.some((q) => q.key === key));
}
