"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";

/**
 * Count of alerts still waiting on the user.
 *
 * Rendered inside the nav link, so it carries its own text label for screen
 * readers — the number alone reads as noise out of context.
 */
export function AlertBadge() {
  const count = useLiveQuery(
    async () => db().alerts.filter((a) => !a.acknowledgedAt).count(),
    [],
    0,
  );

  if (!count) return null;

  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-critical px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread alerts</span>
    </span>
  );
}
