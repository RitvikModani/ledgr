import { daysBetween } from "@/lib/format/date";
import type { Transaction } from "@/lib/db/types";

export interface TransferFlag {
  hash: string;
  reason: string;
  /** The hash of the matching leg, when the pair was found by amount matching. */
  pairedWith?: string;
}

/** Narrations that identify a self-transfer on their own, without a matching leg. */
const SELF_TRANSFER_KEYWORDS = [
  "credit card payment",
  "card payment",
  "cc payment",
  "payment received thank you",
  "autopay",
  "self",
  "own account",
  "transfer to own",
  "fund transfer",
  "sweep in",
  "sweep out",
  "linked account",
];

const MATCH_WINDOW_DAYS = 4;

/**
 * Finds money that only moved between the user's own pockets.
 *
 * This matters more than it looks. Someone moving ₹50,000 a month into SIPs and
 * paying a ₹40,000 card bill has ₹90,000 of fake expense and ₹50,000 of fake
 * income in their statement. Counted naively, their savings rate is nonsense and
 * every budget envelope is wrong.
 *
 * Two signals, either sufficient:
 *   1. the narration names a self-transfer outright
 *   2. an equal and opposite amount appears within a few days on another account
 *
 * The second rule is deliberately restricted to *different accounts*: a ₹2,000
 * refund from the same merchant you paid ₹2,000 to is a real refund, not a
 * transfer, and cancelling it would hide both sides of a genuine event.
 */
export function detectTransfers(transactions: Transaction[]): TransferFlag[] {
  const flags = new Map<string, TransferFlag>();

  for (const tx of transactions) {
    const haystack = ` ${tx.merchant} ${tx.description.toLowerCase()} `;
    const keyword = SELF_TRANSFER_KEYWORDS.find((k) => haystack.includes(k));
    if (keyword) {
      flags.set(tx.hash, { hash: tx.hash, reason: `Narration says "${keyword}"` });
    }
  }

  // Bucket by absolute amount so matching is linear rather than quadratic.
  const byAmount = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const key = Math.abs(tx.amount).toFixed(2);
    const bucket = byAmount.get(key);
    if (bucket) bucket.push(tx);
    else byAmount.set(key, [tx]);
  }

  const paired = new Set<string>();

  for (const bucket of byAmount.values()) {
    if (bucket.length < 2) continue;

    const debits = bucket.filter((t) => t.amount < 0);
    const credits = bucket.filter((t) => t.amount > 0);

    for (const debit of debits) {
      if (paired.has(debit.hash)) continue;

      const match = credits.find(
        (credit) =>
          !paired.has(credit.hash) &&
          credit.account !== debit.account &&
          Math.abs(daysBetween(debit.date, credit.date)) <= MATCH_WINDOW_DAYS,
      );
      if (!match) continue;

      paired.add(debit.hash);
      paired.add(match.hash);

      const reason = "Matching opposite amount on another account";
      flags.set(debit.hash, { hash: debit.hash, reason, pairedWith: match.hash });
      flags.set(match.hash, { hash: match.hash, reason, pairedWith: debit.hash });
    }
  }

  return [...flags.values()];
}

/**
 * Applies the flags, leaving anything the user already categorised by hand
 * alone. Returns a new array — callers show a diff before committing.
 */
export function applyTransferFlags(
  transactions: Transaction[],
  flags: TransferFlag[],
): Transaction[] {
  const flagged = new Set(flags.map((f) => f.hash));
  return transactions.map((tx) =>
    flagged.has(tx.hash) && !tx.categoryLocked ? { ...tx, category: "Transfer" } : tx,
  );
}
