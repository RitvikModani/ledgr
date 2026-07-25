import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  answerInterview,
  getInterview,
  getSettings,
  LedgrDatabase,
  saveSettings,
  setDatabaseForTesting,
  wipeAll,
} from "./db";
import {
  insertTransactions,
  listBudgets,
  replaceAutoBudgets,
  saveBudget,
  setTransactionCategory,
  transactionsInMonth,
} from "./repositories";
import type { Transaction } from "./types";

let database: LedgrDatabase;
let counter = 0;

beforeEach(async () => {
  database = new LedgrDatabase(`ledgr-test-${counter++}`);
  setDatabaseForTesting(database);
  await database.open();
});

afterEach(async () => {
  await database.delete();
  setDatabaseForTesting(null);
});

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    date: "2026-04-10",
    month: "2026-04",
    description: "SWIGGY ORDER 8812",
    merchant: "swiggy",
    amount: -450,
    category: "Dining",
    account: "HDFC",
    hash: "h1",
    importId: "imp-1",
    ...overrides,
  };
}

describe("settings", () => {
  it("returns defaults before anything is stored", async () => {
    const settings = await getSettings();
    expect(settings.currency).toBe("INR");
    expect(settings.notifications.emailDigest).toBe(false);
  });

  it("merges nested notification keys instead of replacing the object", async () => {
    await saveSettings({ notifications: { email: "a@b.com" } as never });
    const settings = await getSettings();
    expect(settings.notifications.email).toBe("a@b.com");
    // Would be undefined if the patch had clobbered the nested object.
    expect(settings.notifications.digestFrequency).toBe("weekly");
  });
});

describe("interview", () => {
  it("records which fields the user actually answered", async () => {
    await answerInterview("monthlyTakeHome", 120000);
    const profile = await getInterview();

    expect(profile.monthlyTakeHome).toBe(120000);
    expect(profile.answered).toContain("monthlyTakeHome");
    // Untouched fields keep their default and stay out of `answered`, so the
    // plan can flag them as assumptions.
    expect(profile.age).toBe(30);
    expect(profile.answered).not.toContain("age");
  });

  it("does not duplicate a key when the same question is answered twice", async () => {
    await answerInterview("age", 34);
    await answerInterview("age", 35);
    const profile = await getInterview();

    expect(profile.age).toBe(35);
    expect(profile.answered.filter((k) => k === "age")).toHaveLength(1);
  });
});

describe("insertTransactions", () => {
  it("inserts a clean batch", async () => {
    const result = await insertTransactions([tx({ hash: "a" }), tx({ hash: "b" })]);
    expect(result).toEqual({ imported: 2, duplicates: 0 });
  });

  it("keeps the new rows and reports the overlap when a statement is re-imported", async () => {
    await insertTransactions([tx({ hash: "a" }), tx({ hash: "b" })]);

    const second = await insertTransactions([
      tx({ hash: "b" }), // already present
      tx({ hash: "c" }), // new
    ]);

    expect(second).toEqual({ imported: 1, duplicates: 1 });
    expect(await transactionsInMonth("2026-04")).toHaveLength(3);
  });

  it("is a no-op on an empty batch", async () => {
    expect(await insertTransactions([])).toEqual({ imported: 0, duplicates: 0 });
  });
});

describe("setTransactionCategory", () => {
  it("locks the edited row and moves every other row from the same merchant", async () => {
    await insertTransactions([
      tx({ hash: "a", merchant: "swiggy", category: "Dining" }),
      tx({ hash: "b", merchant: "swiggy", category: "Dining" }),
      tx({ hash: "c", merchant: "uber", category: "Transport" }),
    ]);

    const target = await database.transactions.where("hash").equals("a").first();
    await setTransactionCategory(target!.id!, "Groceries");

    const rows = await database.transactions.toArray();
    const swiggy = rows.filter((r) => r.merchant === "swiggy");
    expect(swiggy.every((r) => r.category === "Groceries")).toBe(true);
    expect(swiggy.find((r) => r.hash === "a")?.categoryLocked).toBe(true);

    // A different merchant is untouched.
    expect(rows.find((r) => r.merchant === "uber")?.category).toBe("Transport");

    // And the correction is remembered for future imports.
    expect((await database.overrides.get("swiggy"))?.category).toBe("Groceries");
  });
});

describe("replaceAutoBudgets", () => {
  it("replaces derived envelopes but never overwrites a hand-set one", async () => {
    await saveBudget("Rent", 30000, false); // typed by the user
    await saveBudget("Dining", 4000, true); // previous auto guess

    await replaceAutoBudgets([
      { category: "Rent", monthlyLimit: 99999 },
      { category: "Dining", monthlyLimit: 6000 },
      { category: "Fuel", monthlyLimit: 3000 },
    ]);

    const budgets = await listBudgets();
    const byCategory = Object.fromEntries(budgets.map((b) => [b.category, b]));

    expect(byCategory.Rent.monthlyLimit).toBe(30000);
    expect(byCategory.Rent.auto).toBe(false);
    expect(byCategory.Dining.monthlyLimit).toBe(6000);
    expect(byCategory.Fuel.monthlyLimit).toBe(3000);
  });
});

describe("wipeAll", () => {
  it("clears every table", async () => {
    await insertTransactions([tx({ hash: "a" })]);
    await saveSettings({ liquidSavings: 50000 });
    await answerInterview("age", 41);

    await wipeAll();

    expect(await database.transactions.count()).toBe(0);
    expect((await getSettings()).liquidSavings).toBe(0);
    expect((await getInterview()).age).toBe(30);
  });
});
