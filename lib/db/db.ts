import Dexie, { type Table } from "dexie";
import {
  DEFAULT_INTERVIEW,
  DEFAULT_SETTINGS,
  type Alert,
  type Budget,
  type CategoryOverride,
  type Goal,
  type Holding,
  type ImportBatch,
  type InterviewProfile,
  type Scenario,
  type Settings,
  type Transaction,
} from "./types";

/**
 * The whole database lives in the browser. There is no server copy of anything
 * here, which is the point — but it also means the user's data is exactly as
 * durable as their browser profile. Settings offers an export, and the app says
 * so plainly rather than implying a backup exists.
 */
export class LedgrDatabase extends Dexie {
  transactions!: Table<Transaction, number>;
  imports!: Table<ImportBatch, string>;
  goals!: Table<Goal, number>;
  budgets!: Table<Budget, number>;
  alerts!: Table<Alert, number>;
  scenarios!: Table<Scenario, number>;
  overrides!: Table<CategoryOverride, string>;
  holdings!: Table<Holding, number>;
  settings!: Table<Settings, string>;
  interview!: Table<InterviewProfile, string>;

  constructor(name = "ledgr") {
    super(name);

    this.version(1).stores({
      // `&hash` is the dedupe guarantee: re-importing an overlapping statement
      // throws a ConstraintError per duplicate row rather than double-counting.
      transactions: "++id, date, month, category, merchant, account, &hash, importId",
      imports: "id, importedAt",
      goals: "++id, targetDate, priority, kind",
      budgets: "++id, &category",
      alerts: "++id, kind, severity, createdAt, &dedupeKey, acknowledgedAt",
      scenarios: "++id, createdAt",
      overrides: "&merchant",
      holdings: "++id, assetClass, instrument",
      settings: "id",
      interview: "id",
    });
  }
}

let instance: LedgrDatabase | null = null;

/**
 * Lazily constructed so importing anything from lib/db during server rendering
 * does not try to open IndexedDB in Node.
 */
export function db(): LedgrDatabase {
  if (!instance) instance = new LedgrDatabase();
  return instance;
}

/** Tests use this to swap in a throwaway database per suite. */
export function setDatabaseForTesting(next: LedgrDatabase | null): void {
  instance = next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await db().settings.get("singleton");
  if (!stored) return DEFAULT_SETTINGS;
  // Merge rather than return: a database written by an older build may predate
  // a settings key, and a missing nested object would crash the consumer.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    id: "singleton",
    notifications: { ...current.notifications, ...patch.notifications },
  };
  await db().settings.put(next);
  return next;
}

export async function getInterview(): Promise<InterviewProfile> {
  const stored = await db().interview.get("singleton");
  if (!stored) return DEFAULT_INTERVIEW;
  return { ...DEFAULT_INTERVIEW, ...stored, answered: stored.answered ?? [] };
}

export async function saveInterview(
  patch: Partial<InterviewProfile>,
): Promise<InterviewProfile> {
  const current = await getInterview();
  const next: InterviewProfile = { ...current, ...patch, id: "singleton" };
  await db().interview.put(next);
  return next;
}

/**
 * Records an answer and marks the field as user-supplied.
 *
 * The `answered` list is what lets the plan distinguish "you told us ₹80,000"
 * from "we assumed ₹80,000", so it has to be updated in the same transaction
 * as the value itself.
 */
export async function answerInterview<K extends keyof InterviewProfile>(
  key: K,
  value: InterviewProfile[K],
): Promise<InterviewProfile> {
  const current = await getInterview();
  const answered = current.answered.includes(key as string)
    ? current.answered
    : [...current.answered, key as string];
  return saveInterview({ [key]: value, answered } as Partial<InterviewProfile>);
}

/** Everything the user owns, in one JSON blob, for the Settings export button. */
export async function exportAll() {
  const d = db();
  const [transactions, imports, goals, budgets, alerts, scenarios, overrides, holdings] =
    await Promise.all([
      d.transactions.toArray(),
      d.imports.toArray(),
      d.goals.toArray(),
      d.budgets.toArray(),
      d.alerts.toArray(),
      d.scenarios.toArray(),
      d.overrides.toArray(),
      d.holdings.toArray(),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    settings: await getSettings(),
    interview: await getInterview(),
    transactions,
    imports,
    goals,
    budgets,
    alerts,
    scenarios,
    overrides,
    holdings,
  };
}

export async function wipeAll(): Promise<void> {
  const d = db();
  await d.transaction(
    "rw",
    [
      d.transactions,
      d.imports,
      d.goals,
      d.budgets,
      d.alerts,
      d.scenarios,
      d.overrides,
      d.holdings,
      d.settings,
      d.interview,
    ],
    async () => {
      await Promise.all([
        d.transactions.clear(),
        d.imports.clear(),
        d.goals.clear(),
        d.budgets.clear(),
        d.alerts.clear(),
        d.scenarios.clear(),
        d.overrides.clear(),
        d.holdings.clear(),
        d.settings.clear(),
        d.interview.clear(),
      ]);
    },
  );
}
