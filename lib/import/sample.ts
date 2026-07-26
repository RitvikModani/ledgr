import { saveInterview } from "@/lib/db/db";
import { insertHoldings, insertTransactions, recordImport, saveGoal } from "@/lib/db/repositories";
import { buildHoldings } from "./buildHoldings";
import { buildTransactions } from "./buildTransactions";
import { detectColumns, HOLDING_FIELDS, TRANSACTION_FIELDS } from "./detect";
import { readWorkbook } from "./readWorkbook";
import { applyTransferFlags, detectTransfers } from "./transfers";
import { addCalendarMonths, todayISO } from "@/lib/format/date";

/**
 * Loads the shipped sample dataset.
 *
 * Goes through the real import pipeline rather than seeding the database
 * directly. If the sample were inserted as pre-baked rows, it would keep
 * working after the parser broke — which is precisely when someone trying the
 * app would be misled into thinking their own file should have worked too.
 */
export async function loadSampleData(): Promise<{ transactions: number; holdings: number }> {
  const response = await fetch("/ledgr-sample-data.xlsx");
  if (!response.ok) throw new Error("The sample file could not be loaded.");

  const blob = await response.blob();
  const file = new File([blob], "ledgr-sample-data.xlsx", { type: blob.type });

  const sheets = await readWorkbook(file);
  const importId = `sample-${Date.now()}`;

  const statement = sheets.find((s) => /statement/i.test(s.name)) ?? sheets[0];
  const detected = detectColumns(statement.rows, TRANSACTION_FIELDS);
  const built = buildTransactions(statement.rows, {
    mapping: detected.mapping,
    headerRow: detected.headerRow,
    importId,
    defaultAccount: "HDFC Savings",
  });

  const rows = applyTransferFlags(built.transactions, detectTransfers(built.transactions));
  const inserted = await insertTransactions(rows);

  let holdingCount = 0;
  const holdingSheet = sheets.find((s) => /holding/i.test(s.name));
  if (holdingSheet) {
    const holdingDetection = detectColumns(holdingSheet.rows, HOLDING_FIELDS);
    const holdings = buildHoldings(
      holdingSheet.rows,
      holdingDetection.mapping,
      holdingDetection.headerRow,
      importId,
    );
    holdingCount = await insertHoldings(holdings.holdings);
  }

  await recordImport({
    id: importId,
    fileName: "ledgr-sample-data.xlsx",
    sheetName: statement.name,
    importedAt: Date.now(),
    rowsRead: statement.rows.length - detected.headerRow - 1,
    rowsImported: inserted.imported,
    rowsSkipped: built.errors.length,
    rowsDuplicate: inserted.duplicates,
  });

  await seedSampleProfile();

  return { transactions: inserted.imported, holdings: holdingCount };
}

const SAMPLE_ANSWERED = [
  "age", "retirementAge", "dependents", "supportsParents",
  "monthlyTakeHome", "incomeStability", "expectedAnnualRaise",
  "housing", "monthlyRentOrEmi", "totalDebt", "highestDebtRate",
  "hasHealthInsurance", "healthCoverAmount", "hasTermInsurance",
  "liquidSavings", "equityValue", "debtInvestmentValue", "goldValue",
  "existingMonthlySip", "selfRatedRisk", "marketDropReaction",
  "investmentHorizonYears", "topPriority", "taxBracket",
];

/**
 * A profile to match the sample statement.
 *
 * Chosen so the app has something to say: this person is under-insured, holds
 * an expensive card balance and is short of an emergency fund, so the alert
 * rules and the "before you invest" list both have real content instead of an
 * empty state.
 */
async function seedSampleProfile() {
  await saveInterview({
    age: 31,
    retirementAge: 60,
    dependents: 1,
    supportsParents: true,
    monthlyTakeHome: 132000,
    otherMonthlyIncome: 0,
    incomeStability: "stable",
    expectedAnnualRaise: 0.09,
    housing: "owned-with-loan",
    monthlyRentOrEmi: 34000,
    totalDebt: 180000,
    highestDebtRate: 0.36,
    hasHealthInsurance: true,
    healthCoverAmount: 500000,
    hasTermInsurance: false,
    termCoverAmount: 0,
    liquidSavings: 240000,
    equityValue: 1375000,
    debtInvestmentValue: 2526500,
    goldValue: 410000,
    existingMonthlySip: 15000,
    selfRatedRisk: 4,
    marketDropReaction: "hold",
    investmentHorizonYears: 20,
    topPriority: "home",
    taxBracket: 0.3,
    lastStep: 0,
    completedAt: Date.now(),
    // Marked as answered so the sample does not present itself as a plan built
    // on defaults — the "this is running on assumptions" warnings would be
    // wrong here, because every one of these numbers is deliberate.
    answered: SAMPLE_ANSWERED,
  });

  await saveGoal({
    name: "House down payment",
    kind: "home",
    targetAmount: 4000000,
    currentAmount: 850000,
    targetDate: addCalendarMonths(todayISO(), 72),
    priority: "high",
    expectedAnnualReturn: 0.1,
    inflationRate: 0.07,
    monthlyContribution: 25000,
    createdAt: Date.now(),
  });

  await saveGoal({
    name: "Emergency fund",
    kind: "emergency-fund",
    targetAmount: 560000,
    currentAmount: 240000,
    targetDate: addCalendarMonths(todayISO(), 18),
    priority: "high",
    expectedAnnualReturn: 0.06,
    inflationRate: 0.05,
    monthlyContribution: 8000,
    createdAt: Date.now(),
  });

  await saveGoal({
    name: "Retirement",
    kind: "retirement",
    targetAmount: 60000000,
    currentAmount: 3900000,
    targetDate: addCalendarMonths(todayISO(), 348),
    priority: "medium",
    expectedAnnualReturn: 0.12,
    inflationRate: 0.06,
    monthlyContribution: 15000,
    createdAt: Date.now(),
  });
}
