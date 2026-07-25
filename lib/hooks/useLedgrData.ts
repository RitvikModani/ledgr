"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, getInterview, getSettings } from "@/lib/db/db";
import { DEFAULT_INTERVIEW, DEFAULT_SETTINGS } from "@/lib/db/types";
import type {
  Budget,
  Goal,
  Holding,
  InterviewProfile,
  Settings,
  Transaction,
} from "@/lib/db/types";

export interface LedgrData {
  transactions: Transaction[];
  goals: Goal[];
  budgets: Budget[];
  holdings: Holding[];
  settings: Settings;
  interview: InterviewProfile;
  /** Distinguishes "still reading IndexedDB" from "read it, there is nothing". */
  loading: boolean;
}

const EMPTY: LedgrData = {
  transactions: [],
  goals: [],
  budgets: [],
  holdings: [],
  settings: DEFAULT_SETTINGS,
  interview: DEFAULT_INTERVIEW,
  loading: true,
};

/**
 * Everything the pages read, in one live query.
 *
 * A single subscription rather than six: `useLiveQuery` re-runs on any write to
 * a table it touched, and six independent hooks would each re-render the page
 * separately after one import, producing a visible cascade of half-updated
 * charts.
 */
export function useLedgrData(): LedgrData {
  const data = useLiveQuery(async () => {
    const [transactions, goals, budgets, holdings, settings, interview] = await Promise.all([
      db().transactions.orderBy("date").toArray(),
      db().goals.toArray(),
      db().budgets.toArray(),
      db().holdings.toArray(),
      getSettings(),
      getInterview(),
    ]);

    return {
      transactions,
      goals,
      budgets,
      holdings,
      settings,
      interview,
      loading: false,
    } satisfies LedgrData;
  }, []);

  return data ?? EMPTY;
}
