"use client";

import { useEffect, useRef } from "react";
import { db } from "@/lib/db/db";
import { markAlertsNotified } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { digestIsDue, notifyBrowser, sendDigest } from "@/lib/alerts/digest";

/**
 * Re-evaluates the alert rules when the app opens.
 *
 * There is no server and no cron, so "when you open it" is the only moment
 * Ledgr gets to check anything. This runs once per mount, after the data has
 * actually loaded, and never on every render — re-evaluating on each keystroke
 * of a settings field would hammer IndexedDB for no benefit.
 *
 * Rendering nothing on purpose: it is a side effect, not UI.
 */
export function AlertRunner() {
  const data = useLedgrData();
  const hasRun = useRef(false);

  useEffect(() => {
    if (data.loading || hasRun.current) return;
    // Nothing to evaluate against, and nothing worth telling anyone.
    if (data.transactions.length === 0 && data.interview.answered.length === 0) return;

    hasRun.current = true;

    void (async () => {
      try {
        await evaluateAlerts(data);

        const open = await db().alerts.filter((a) => !a.acknowledgedAt).toArray();

        if (data.settings.notifications.browserPush) {
          const notified = open.filter(
            (a) => !a.notifiedAt && (a.severity === "critical" || a.severity === "serious"),
          );
          await notifyBrowser(open);
          if (notified.length > 0) {
            await markAlertsNotified(notified.map((a) => a.id!).filter(Boolean));
          }
        }

        // Digests are sent on open when one is due, since there is no server
        // schedule to send them from.
        if (digestIsDue(data.settings, open)) {
          await sendDigest(data.settings, open);
        }
      } catch {
        // An alert check failing must never break the page the user came for.
      }
    })();
  }, [data]);

  return null;
}
