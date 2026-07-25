import { describe, expect, it } from "vitest";
import { buildTransactions, looksLikePositiveExpenseSheet } from "./buildTransactions";
import { buildHoldings, guessInstrument } from "./buildHoldings";
import { detectColumns, findHeaderRow, HOLDING_FIELDS, TRANSACTION_FIELDS } from "./detect";
import { applyTransferFlags, detectTransfers } from "./transfers";
import { classify } from "@/lib/categorize/classify";
import type { Transaction } from "@/lib/db/types";

/** A realistic HDFC-style export: title block, blank line, then the real header. */
const BANK_SHEET = [
  ["HDFC BANK LTD"],
  ["Account Statement for 50100123456789"],
  ["From : 01/04/2026 To : 30/04/2026"],
  [],
  ["Date", "Narration", "Chq/Ref No", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
  ["01/04/2026", "UPI/SWIGGY/428193847/OKHDFCBANK", "0000", "450.00", "", "1,24,550.00"],
  ["03/04/2026", "SALARY CREDIT APRIL", "SAL0423", "", "1,20,000.00", "2,44,550.00"],
  ["05/04/2026", "NEFT DR-RENT-LANDLORD", "N0512", "30,000.00", "", "2,14,550.00"],
  ["13/04/2026", "UPI/BIGBASKET/9928374/@okicici", "0000", "2,340.50", "", "2,12,209.50"],
  ["", "", "", "", "", ""],
  ["TOTAL", "", "", "32,790.50", "1,20,000.00", ""],
];

describe("findHeaderRow", () => {
  it("skips the title block and finds the real header", () => {
    // Assuming row 1 is the header is the most common way a bank import fails.
    expect(findHeaderRow(BANK_SHEET, TRANSACTION_FIELDS)).toBe(4);
  });

  it("uses row 0 when the sheet starts cleanly", () => {
    const clean = [
      ["Date", "Description", "Amount"],
      ["2026-04-01", "Coffee", "-250"],
    ];
    expect(findHeaderRow(clean, TRANSACTION_FIELDS)).toBe(0);
  });
});

describe("detectColumns", () => {
  it("maps a debit/credit bank statement without inventing an amount column", () => {
    const result = detectColumns(BANK_SHEET, TRANSACTION_FIELDS);

    expect(result.headerRow).toBe(4);
    expect(result.mapping.date).toBe(0);
    expect(result.mapping.description).toBe(1);
    expect(result.mapping.debit).toBe(3);
    expect(result.mapping.credit).toBe(4);
    expect(result.mapping.balance).toBe(5);
    // A sheet with debit and credit columns has no signed amount column.
    expect(result.mapping.amount).toBeUndefined();
  });

  it("maps a simple signed-amount sheet", () => {
    const sheet = [
      ["Txn Date", "Particulars", "Amount", "Category"],
      ["01/04/2026", "Swiggy", "-450", "Dining"],
      ["03/04/2026", "Salary", "120000", "Income"],
    ];
    const result = detectColumns(sheet, TRANSACTION_FIELDS);

    expect(result.mapping.date).toBe(0);
    expect(result.mapping.description).toBe(1);
    expect(result.mapping.amount).toBe(2);
    expect(result.mapping.category).toBe(3);
  });

  it("never assigns one column to two roles", () => {
    const result = detectColumns(BANK_SHEET, TRANSACTION_FIELDS);
    const used = Object.values(result.mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it("falls back to cell shape when headers are unhelpful", () => {
    const sheet = [
      ["A", "B", "C"],
      ["01/04/2026", "Swiggy Bangalore", "-450"],
      ["03/04/2026", "Big Bazaar Store", "-1200"],
      ["05/04/2026", "Uber Ride Home", "-320"],
      ["07/04/2026", "Amazon Order", "-2400"],
      ["09/04/2026", "Zomato Dinner", "-780"],
    ];
    const result = detectColumns(sheet, TRANSACTION_FIELDS);

    expect(result.mapping.date).toBe(0);
    expect(result.mapping.description).toBe(1);
    expect(result.mapping.amount).toBe(2);
  });
});

describe("buildTransactions", () => {
  const { mapping, headerRow } = detectColumns(BANK_SHEET, TRANSACTION_FIELDS);

  const result = buildTransactions(BANK_SHEET, {
    mapping,
    headerRow,
    importId: "imp-1",
    defaultAccount: "HDFC",
  });

  it("imports every data row", () => {
    expect(result.transactions).toHaveLength(4);
    expect(result.errors).toHaveLength(0);
  });

  it("normalises debit and credit columns onto one signed amount", () => {
    const swiggy = result.transactions[0];
    const salary = result.transactions[1];

    expect(swiggy.amount).toBe(-450);
    expect(salary.amount).toBe(120000);
  });

  it("reads Indian grouping in the balance column", () => {
    expect(result.transactions[0].balance).toBe(124550);
  });

  it("infers day-first dates from the 13/04 row", () => {
    expect(result.dateOrder).toBe("day-first");
    expect(result.transactions[3].date).toBe("2026-04-13");
    expect(result.transactions[3].month).toBe("2026-04");
  });

  it("skips blank rows and the totals row without reporting them as errors", () => {
    expect(result.ignored).toBe(2);
  });

  it("categorises from the merchant keywords", () => {
    expect(result.transactions[0].category).toBe("Dining");
    expect(result.transactions[1].category).toBe("Income");
    expect(result.transactions[2].category).toBe("Rent");
    expect(result.transactions[3].category).toBe("Groceries");
  });

  it("reports unreadable rows individually instead of failing the file", () => {
    const messy = [
      ["Date", "Description", "Amount"],
      ["01/04/2026", "Good row", "-450"],
      ["not a date", "Bad date", "-100"],
      ["02/04/2026", "Bad amount", "N/A"],
      ["03/04/2026", "", "-100"],
      ["04/04/2026", "Another good row", "-200"],
    ];
    const detected = detectColumns(messy, TRANSACTION_FIELDS);
    const built = buildTransactions(messy, {
      mapping: detected.mapping,
      headerRow: detected.headerRow,
      importId: "imp-2",
      defaultAccount: "Test",
    });

    expect(built.transactions).toHaveLength(2);
    expect(built.errors).toHaveLength(3);
    // Row numbers match what the user sees in the spreadsheet.
    expect(built.errors.map((e) => e.sheetRow)).toEqual([3, 4, 5]);
    expect(built.errors[0].reason).toBe("No readable date");
  });

  it("keeps genuine same-day repeats of the same amount", () => {
    const repeats = [
      ["Date", "Description", "Amount"],
      ["01/04/2026", "Chai", "-20"],
      ["01/04/2026", "Chai", "-20"],
    ];
    const detected = detectColumns(repeats, TRANSACTION_FIELDS);
    const built = buildTransactions(repeats, {
      mapping: detected.mapping,
      headerRow: detected.headerRow,
      importId: "imp-3",
      defaultAccount: "Test",
    });

    // Two coffees on one day are two transactions, not one duplicate.
    expect(built.transactions).toHaveLength(2);
    expect(built.transactions[0].hash).not.toBe(built.transactions[1].hash);
  });

  it("flips an all-positive expense sheet when asked", () => {
    const tracker = [
      ["Date", "Item", "Amount"],
      ["01/04/2026", "Swiggy", "450"],
      ["02/04/2026", "Uber", "320"],
      ["03/04/2026", "Bigbasket", "2100"],
      ["04/04/2026", "Petrol", "3000"],
      ["05/04/2026", "Netflix", "649"],
    ];
    const detected = detectColumns(tracker, TRANSACTION_FIELDS);

    expect(
      looksLikePositiveExpenseSheet(tracker, detected.mapping, detected.headerRow),
    ).toBe(true);

    const built = buildTransactions(tracker, {
      mapping: detected.mapping,
      headerRow: detected.headerRow,
      importId: "imp-4",
      defaultAccount: "Test",
      amountsArePositiveExpenses: true,
    });

    expect(built.transactions.every((t) => t.amount < 0)).toBe(true);
  });

  it("does not flag a sheet that already has negatives", () => {
    const mixed = [
      ["Date", "Item", "Amount"],
      ["01/04/2026", "Swiggy", "-450"],
      ["02/04/2026", "Salary", "120000"],
    ];
    const detected = detectColumns(mixed, TRANSACTION_FIELDS);
    expect(
      looksLikePositiveExpenseSheet(mixed, detected.mapping, detected.headerRow),
    ).toBe(false);
  });
});

describe("classify", () => {
  it("lets a user correction beat every other signal", () => {
    const overrides = new Map([["swiggy", "Groceries"]]);
    expect(classify("swiggy", -450, { overrides, sheetCategory: "Dining" })).toBe("Groceries");
  });

  it("trusts the sheet's own category over keyword rules", () => {
    expect(classify("swiggy", -450, { sheetCategory: "Entertainment" })).toBe("Entertainment");
  });

  it("maps common category aliases onto the seeded set", () => {
    expect(classify("anything", -100, { sheetCategory: "food" })).toBe("Dining");
    expect(classify("anything", -100, { sheetCategory: "telecom" })).toBe("Mobile & Internet");
  });

  it("prefers the narrower rule when several could match", () => {
    // Insurance before Health, subscriptions before entertainment.
    expect(classify("star health insurance premium", -12000)).toBe("Insurance");
    expect(classify("netflix", -649)).toBe("Subscriptions");
    expect(classify("hdfc home loan emi", -45000)).toBe("EMI");
  });

  it("matches keywords on word boundaries, not as substrings", () => {
    // Regression: "premium" contains "emi", so substring matching filed every
    // insurance premium as a loan instalment. Same class of bug for sip/gossip.
    expect(classify("star health insurance premium", -12000)).toBe("Insurance");
    expect(classify("office gossip magazine", -200)).not.toBe("Investments");
  });

  it("does not read an income keyword on a debit as income", () => {
    // "salary account maintenance charge" is a fee, not pay.
    expect(classify("salary account maintenance charge", -350)).not.toBe("Income");
  });

  it("treats an unrecognised credit as income and an unrecognised debit as Other", () => {
    expect(classify("some unknown payer", 5000)).toBe("Income");
    expect(classify("some unknown shop", -500)).toBe("Other");
  });
});

describe("detectTransfers", () => {
  function tx(overrides: Partial<Transaction>): Transaction {
    return {
      date: "2026-04-10",
      month: "2026-04",
      description: "x",
      merchant: "x",
      amount: -1000,
      category: "Other",
      account: "HDFC",
      hash: Math.random().toString(36),
      importId: "i",
      ...overrides,
    };
  }

  it("flags a narration that names a self-transfer", () => {
    const rows = [
      tx({ hash: "a", description: "CREDIT CARD PAYMENT", merchant: "credit card payment" }),
      tx({ hash: "b", description: "SWIGGY", merchant: "swiggy" }),
    ];
    const flags = detectTransfers(rows);

    expect(flags.map((f) => f.hash)).toEqual(["a"]);
  });

  it("pairs an equal and opposite amount across two accounts", () => {
    const rows = [
      tx({ hash: "out", amount: -50000, account: "HDFC", date: "2026-04-10" }),
      tx({ hash: "in", amount: 50000, account: "ICICI", date: "2026-04-11" }),
    ];
    const flags = detectTransfers(rows);

    expect(flags).toHaveLength(2);
    expect(flags.find((f) => f.hash === "out")?.pairedWith).toBe("in");
  });

  it("leaves a same-account refund alone", () => {
    // A ₹2,000 refund from the shop you paid ₹2,000 to is a real refund. Zeroing
    // both sides would hide a genuine event.
    const rows = [
      tx({ hash: "paid", amount: -2000, account: "HDFC", date: "2026-04-10" }),
      tx({ hash: "back", amount: 2000, account: "HDFC", date: "2026-04-12" }),
    ];
    expect(detectTransfers(rows)).toHaveLength(0);
  });

  it("does not pair legs that are weeks apart", () => {
    const rows = [
      tx({ hash: "out", amount: -50000, account: "HDFC", date: "2026-04-01" }),
      tx({ hash: "in", amount: 50000, account: "ICICI", date: "2026-04-25" }),
    ];
    expect(detectTransfers(rows)).toHaveLength(0);
  });

  it("recategorises flagged rows but respects a locked category", () => {
    const rows = [
      tx({ hash: "a", amount: -50000, account: "HDFC" }),
      tx({ hash: "b", amount: 50000, account: "ICICI" }),
      tx({ hash: "c", amount: -50000, account: "HDFC", categoryLocked: true, category: "Rent" }),
    ];
    const applied = applyTransferFlags(rows, detectTransfers(rows));

    expect(applied[0].category).toBe("Transfer");
    expect(applied[1].category).toBe("Transfer");
    expect(applied[2].category).toBe("Rent");
  });
});

describe("holdings import", () => {
  const HOLDINGS_SHEET = [
    ["Portfolio as on 25/07/2026"],
    [],
    ["Scheme Name", "Category", "Units", "Avg NAV", "Current Value", "Invested On"],
    ["UTI Nifty 50 Index Fund", "Equity", "1520.45", "128.40", "2,45,000", "12/05/2023"],
    ["HDFC Corporate Bond Fund", "Debt", "4200.00", "26.10", "1,20,000", "08/01/2024"],
    ["Sovereign Gold Bond 2029", "Gold", "40", "5400", "2,60,000", "15/09/2022"],
    ["Public Provident Fund", "Debt", "", "", "8,50,000", "01/04/2019"],
  ];

  const detected = detectColumns(HOLDINGS_SHEET, HOLDING_FIELDS);
  const built = buildHoldings(HOLDINGS_SHEET, detected.mapping, detected.headerRow, "h-1");

  it("finds the header past the title block", () => {
    expect(detected.headerRow).toBe(2);
    expect(detected.mapping.assetName).toBe(0);
    expect(detected.mapping.currentValue).toBe(4);
  });

  it("imports every holding", () => {
    expect(built.holdings).toHaveLength(4);
    expect(built.errors).toHaveLength(0);
  });

  it("classifies instruments and asset classes from the name", () => {
    expect(built.holdings[0].instrument).toBe("index-fund");
    expect(built.holdings[0].assetClass).toBe("equity");
    expect(built.holdings[1].assetClass).toBe("debt");
    expect(built.holdings[2].instrument).toBe("sgb");
    expect(built.holdings[2].assetClass).toBe("gold");
    expect(built.holdings[3].instrument).toBe("ppf");
  });

  it("models a holding with no units as a single unit at its own value", () => {
    const ppf = built.holdings[3];
    expect(ppf.units).toBe(1);
    expect(ppf.avgCost).toBe(850000);
  });

  it("reads the purchase date for XIRR", () => {
    expect(built.holdings[0].purchaseDate).toBe("2023-05-12");
  });
});

describe("guessInstrument", () => {
  it("does not let the generic ETF rule swallow gold ETFs", () => {
    expect(guessInstrument("Nippon India Gold ETF").assetClass).toBe("gold");
    expect(guessInstrument("Nippon India Nifty 50 ETF").assetClass).toBe("equity");
  });

  it("separates ELSS from ordinary equity funds", () => {
    expect(guessInstrument("Mirae Asset Tax Saver Fund").instrument).toBe("elss");
  });

  it("falls back to equity for an unrecognised holding", () => {
    // The conservative direction: drift warnings will surface it rather than
    // quietly ignoring it.
    expect(guessInstrument("Some Unknown Thing").instrument).toBe("other");
    expect(guessInstrument("Some Unknown Thing").assetClass).toBe("equity");
  });
});
