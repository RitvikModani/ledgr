import { classify } from "@/lib/categorize/classify";
import { monthKeyOf } from "@/lib/format/date";
import type { Transaction } from "@/lib/db/types";
import {
  cellToText,
  detectDateOrder,
  normalizeMerchant,
  parseAmount,
  parseDate,
  transactionHash,
  type DateOrder,
} from "./coerce";
import type { ColumnMapping, RawRow } from "./detect";

export interface RowError {
  /** 1-based row number as it appears in the spreadsheet, so the user can find it. */
  sheetRow: number;
  reason: string;
  preview: string;
}

export interface BuildResult {
  transactions: Transaction[];
  errors: RowError[];
  /** Rows that were blank or obviously not data (totals, page footers). */
  ignored: number;
  dateOrder: DateOrder;
}

export interface BuildOptions {
  mapping: ColumnMapping;
  headerRow: number;
  importId: string;
  defaultAccount: string;
  overrides?: Map<string, string>;
  /**
   * Sheets that list expenses as positive numbers in a single Amount column.
   * Without this the whole file imports as income.
   */
  amountsArePositiveExpenses?: boolean;
}

const SUMMARY_ROW = /^\s*(total|grand total|closing balance|opening balance|balance b\/?f|balance c\/?f|sub[- ]?total|page \d+)/i;

/**
 * Turns mapped rows into transactions, collecting per-row failures rather than
 * aborting.
 *
 * A statement with three unparseable rows out of four hundred should import
 * three hundred and ninety-seven and tell the user about the three. Throwing on
 * the first bad row would make the whole file unusable for no good reason.
 */
export function buildTransactions(rows: RawRow[], options: BuildOptions): BuildResult {
  const { mapping, headerRow, importId, defaultAccount, overrides } = options;
  const body = rows.slice(headerRow + 1);

  const dateColumn = mapping.date;
  const dateOrder =
    dateColumn === undefined
      ? "day-first"
      : detectDateOrder(body.map((r) => r[dateColumn]));

  const transactions: Transaction[] = [];
  const errors: RowError[] = [];
  let ignored = 0;

  const seen = new Set<string>();

  body.forEach((row, i) => {
    const sheetRow = headerRow + 2 + i;
    const preview = row
      .map((c) => cellToText(c))
      .filter(Boolean)
      .join(" | ")
      .slice(0, 90);

    if (!preview) {
      ignored++;
      return;
    }

    // Totals and page footers are not transactions; skipping them quietly is
    // correct, reporting them as errors would just be noise.
    if (SUMMARY_ROW.test(preview)) {
      ignored++;
      return;
    }

    const date = dateColumn === undefined ? null : parseDate(row[dateColumn], dateOrder);
    if (!date) {
      errors.push({ sheetRow, reason: "No readable date", preview });
      return;
    }

    const amount = resolveAmount(row, options);
    if (amount === null) {
      errors.push({ sheetRow, reason: "No readable amount", preview });
      return;
    }
    if (amount === 0) {
      ignored++;
      return;
    }

    const description =
      mapping.description === undefined
        ? ""
        : cellToText(row[mapping.description]).slice(0, 200);

    if (!description) {
      errors.push({ sheetRow, reason: "No description", preview });
      return;
    }

    const merchant = normalizeMerchant(description);
    const hash = transactionHash(date, amount, merchant);

    // Two identical rows inside one file are almost always a genuine repeat
    // (two coffees on one day), so they are disambiguated rather than dropped.
    // Cross-file duplicates are a different problem, handled by the unique index.
    let uniqueHash = hash;
    let suffix = 1;
    while (seen.has(uniqueHash)) {
      uniqueHash = `${hash}#${suffix++}`;
    }
    seen.add(uniqueHash);

    const sheetCategory =
      mapping.category === undefined ? undefined : cellToText(row[mapping.category]);
    const account =
      mapping.account === undefined
        ? defaultAccount
        : cellToText(row[mapping.account]) || defaultAccount;
    const balance =
      mapping.balance === undefined ? undefined : (parseAmount(row[mapping.balance]) ?? undefined);

    transactions.push({
      date,
      month: monthKeyOf(date),
      description,
      merchant,
      amount,
      category: classify(merchant, amount, { overrides, sheetCategory }),
      account,
      balance,
      hash: uniqueHash,
      importId,
    });
  });

  return { transactions, errors, ignored, dateOrder };
}

/**
 * Resolves a row's signed amount from whichever shape the sheet uses.
 *
 * Three layouts are common and all end up on Ledgr's convention of
 * expense-negative / income-positive:
 *   - one signed Amount column
 *   - separate Debit and Credit columns
 *   - one all-positive Amount column of expenses (opted into by the user)
 */
function resolveAmount(row: RawRow, options: BuildOptions): number | null {
  const { mapping, amountsArePositiveExpenses } = options;

  if (mapping.debit !== undefined || mapping.credit !== undefined) {
    const debit = mapping.debit === undefined ? null : parseAmount(row[mapping.debit]);
    const credit = mapping.credit === undefined ? null : parseAmount(row[mapping.credit]);

    if (debit !== null && debit !== 0) return -Math.abs(debit);
    if (credit !== null && credit !== 0) return Math.abs(credit);
    // Both columns present but empty on this row: fall through to Amount if the
    // sheet has one, otherwise this row has no value.
    if (mapping.amount === undefined) return debit === null && credit === null ? null : 0;
  }

  if (mapping.amount === undefined) return null;

  const amount = parseAmount(row[mapping.amount]);
  if (amount === null) return null;

  if (amountsArePositiveExpenses) return -Math.abs(amount);
  return amount;
}

/**
 * Guesses whether a single Amount column is a list of expenses written as
 * positive numbers.
 *
 * An expense tracker exported to Excel usually has no negative numbers at all —
 * importing it as-is turns a year of spending into a year of income. If nothing
 * is negative and the descriptions do not look like a payroll file, it is far
 * more likely to be spending.
 */
export function looksLikePositiveExpenseSheet(
  rows: RawRow[],
  mapping: ColumnMapping,
  headerRow: number,
): boolean {
  if (mapping.amount === undefined) return false;
  if (mapping.debit !== undefined || mapping.credit !== undefined) return false;

  const body = rows.slice(headerRow + 1, headerRow + 201);
  let positives = 0;
  let negatives = 0;

  for (const row of body) {
    const amount = parseAmount(row[mapping.amount]);
    if (amount === null || amount === 0) continue;
    if (amount < 0) negatives++;
    else positives++;
  }

  return negatives === 0 && positives >= 5;
}
