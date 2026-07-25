import { db } from "./db";
import type {
  Alert,
  Budget,
  Goal,
  Holding,
  ImportBatch,
  Scenario,
  Transaction,
} from "./types";
import type { ISODate, MonthKey } from "@/lib/format/date";

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

export interface InsertResult {
  imported: number;
  duplicates: number;
}

/**
 * Inserts a batch, letting the unique `hash` index reject re-imports.
 *
 * `bulkAdd` with `allKeys: false` and a caught BulkError is deliberate: Dexie
 * still writes every non-conflicting row, so an overlapping statement imports
 * exactly the new transactions and reports the rest as duplicates instead of
 * failing the whole batch.
 */
export async function insertTransactions(rows: Transaction[]): Promise<InsertResult> {
  if (rows.length === 0) return { imported: 0, duplicates: 0 };

  try {
    await db().transactions.bulkAdd(rows);
    return { imported: rows.length, duplicates: 0 };
  } catch (error) {
    const failures = (error as { failures?: unknown[] }).failures?.length ?? 0;
    if (failures === 0) throw error;
    return { imported: rows.length - failures, duplicates: failures };
  }
}

export function allTransactions(): Promise<Transaction[]> {
  return db().transactions.orderBy("date").toArray();
}

export function transactionsBetween(from: ISODate, to: ISODate): Promise<Transaction[]> {
  return db().transactions.where("date").between(from, to, true, true).toArray();
}

export function transactionsInMonth(month: MonthKey): Promise<Transaction[]> {
  return db().transactions.where("month").equals(month).toArray();
}

export async function transactionCount(): Promise<number> {
  return db().transactions.count();
}

export async function setTransactionCategory(id: number, category: string): Promise<void> {
  const tx = await db().transactions.get(id);
  if (!tx) return;

  await db().transaction("rw", db().transactions, db().overrides, async () => {
    // Lock the row so the classifier will not overwrite the correction, and
    // remember the merchant so future imports of the same merchant land right.
    await db().transactions.update(id, { category, categoryLocked: true });
    await db().overrides.put({
      merchant: tx.merchant,
      category,
      updatedAt: Date.now(),
    });
    await db()
      .transactions.where("merchant")
      .equals(tx.merchant)
      .and((t) => !t.categoryLocked)
      .modify({ category });
  });
}

export async function deleteImport(importId: string): Promise<number> {
  const deleted = await db().transactions.where("importId").equals(importId).delete();
  await db().imports.delete(importId);
  return deleted;
}

/* -------------------------------------------------------------------------- */
/* Imports                                                                    */
/* -------------------------------------------------------------------------- */

export async function recordImport(batch: ImportBatch): Promise<void> {
  await db().imports.put(batch);
}

export function listImports(): Promise<ImportBatch[]> {
  return db().imports.orderBy("importedAt").reverse().toArray();
}

/* -------------------------------------------------------------------------- */
/* Goals                                                                      */
/* -------------------------------------------------------------------------- */

export function listGoals(): Promise<Goal[]> {
  return db().goals.toArray();
}

export async function saveGoal(goal: Goal): Promise<number> {
  return db().goals.put(goal);
}

export async function deleteGoal(id: number): Promise<void> {
  await db().goals.delete(id);
}

/* -------------------------------------------------------------------------- */
/* Budgets                                                                    */
/* -------------------------------------------------------------------------- */

export function listBudgets(): Promise<Budget[]> {
  return db().budgets.toArray();
}

export async function saveBudget(category: string, monthlyLimit: number, auto: boolean) {
  const existing = await db().budgets.where("category").equals(category).first();
  const row: Budget = {
    ...(existing ?? {}),
    category,
    monthlyLimit,
    auto,
    updatedAt: Date.now(),
  };
  await db().budgets.put(row);
}

/**
 * Writes auto-derived envelopes without touching hand-set ones.
 *
 * A budget the user typed is a decision; a budget we derived is a guess. Re-running
 * auto-budget must never silently overwrite the former.
 */
export async function replaceAutoBudgets(
  envelopes: Array<{ category: string; monthlyLimit: number }>,
): Promise<void> {
  const d = db();
  await d.transaction("rw", d.budgets, async () => {
    const manual = new Set(
      (await d.budgets.toArray()).filter((b) => !b.auto).map((b) => b.category),
    );
    await d.budgets.filter((b) => b.auto).delete();
    const now = Date.now();
    await d.budgets.bulkAdd(
      envelopes
        .filter((e) => !manual.has(e.category))
        .map((e) => ({ ...e, auto: true, updatedAt: now })),
    );
  });
}

export async function deleteBudget(id: number): Promise<void> {
  await db().budgets.delete(id);
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                     */
/* -------------------------------------------------------------------------- */

export function listAlerts(): Promise<Alert[]> {
  return db().alerts.orderBy("createdAt").reverse().toArray();
}

export async function unacknowledgedAlerts(): Promise<Alert[]> {
  return (await listAlerts()).filter((a) => !a.acknowledgedAt);
}

export async function acknowledgeAlert(id: number): Promise<void> {
  await db().alerts.update(id, { acknowledgedAt: Date.now() });
}

export async function acknowledgeAll(): Promise<void> {
  const now = Date.now();
  await db().alerts.filter((a) => !a.acknowledgedAt).modify({ acknowledgedAt: now });
}

export async function markAlertsNotified(ids: number[]): Promise<void> {
  const now = Date.now();
  await db().alerts.where("id").anyOf(ids).modify({ notifiedAt: now });
}

export async function markAlertsDigested(ids: number[]): Promise<void> {
  const now = Date.now();
  await db().alerts.where("id").anyOf(ids).modify({ digestedAt: now });
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

export function listScenarios(): Promise<Scenario[]> {
  return db().scenarios.orderBy("createdAt").reverse().toArray();
}

export async function saveScenario(scenario: Scenario): Promise<number> {
  return db().scenarios.put(scenario);
}

export async function deleteScenario(id: number): Promise<void> {
  await db().scenarios.delete(id);
}

/* -------------------------------------------------------------------------- */
/* Holdings                                                                   */
/* -------------------------------------------------------------------------- */

export function listHoldings(): Promise<Holding[]> {
  return db().holdings.toArray();
}

export async function saveHolding(holding: Holding): Promise<number> {
  return db().holdings.put({ ...holding, updatedAt: Date.now() });
}

export async function deleteHolding(id: number): Promise<void> {
  await db().holdings.delete(id);
}

export async function insertHoldings(rows: Holding[]): Promise<number> {
  if (rows.length === 0) return 0;
  const ids = await db().holdings.bulkAdd(rows, { allKeys: true });
  return ids.length;
}
