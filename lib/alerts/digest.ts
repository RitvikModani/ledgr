import { saveSettings } from "@/lib/db/db";
import { markAlertsDigested } from "@/lib/db/repositories";
import type { Alert, Settings } from "@/lib/db/types";

export interface DigestResult {
  ok: boolean;
  message: string;
}

const FREQUENCY_DAYS = { weekly: 7, monthly: 30 } as const;

/** True when the user opted in, has alerts worth sending, and one is due. */
export function digestIsDue(settings: Settings, alerts: Alert[], now = Date.now()): boolean {
  const { emailDigest, email, digestFrequency, lastDigestSentAt } = settings.notifications;
  if (!emailDigest || !email) return false;

  const pending = alerts.filter((a) => !a.acknowledgedAt && !a.digestedAt);
  if (pending.length === 0) return false;

  if (lastDigestSentAt === null) return true;
  const days = FREQUENCY_DAYS[digestFrequency];
  return now - lastDigestSentAt >= days * 86_400_000;
}

/**
 * Sends a digest of the open alerts.
 *
 * This is the only path in Ledgr by which anything leaves the device, which is
 * why it sends alert titles and bodies rather than any transaction data, and
 * why the recipient address is typed by the user and stored locally rather than
 * held in an account. The route relays it and keeps nothing.
 */
export async function sendDigest(settings: Settings, alerts: Alert[]): Promise<DigestResult> {
  const { email } = settings.notifications;
  if (!email) {
    return { ok: false, message: "Add an email address in Settings first." };
  }

  const pending = alerts.filter((a) => !a.acknowledgedAt);
  if (pending.length === 0) {
    return { ok: false, message: "There is nothing to send — no open alerts." };
  }

  try {
    const response = await fetch("/api/digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        alerts: pending.map((a) => ({
          severity: a.severity,
          title: a.title,
          body: a.body,
        })),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      return {
        ok: false,
        message: payload.error ?? `The digest could not be sent (${response.status}).`,
      };
    }

    await saveSettings({
      notifications: { ...settings.notifications, lastDigestSentAt: Date.now() },
    });
    await markAlertsDigested(pending.map((a) => a.id!).filter(Boolean));

    return { ok: true, message: `Digest sent to ${email}.` };
  } catch {
    return { ok: false, message: "Could not reach the mail service. Nothing was sent." };
  }
}

/**
 * Raises a browser notification for anything not yet notified.
 *
 * Only for the severities that genuinely warrant interrupting someone. A
 * desktop notification for "your gym fee is due on Thursday" is how a user ends
 * up revoking permission and losing the ones that matter.
 */
export async function notifyBrowser(alerts: Alert[]): Promise<number> {
  if (typeof window === "undefined" || !("Notification" in window)) return 0;
  if (Notification.permission !== "granted") return 0;

  const worthInterrupting = alerts.filter(
    (a) => !a.acknowledgedAt && !a.notifiedAt && (a.severity === "critical" || a.severity === "serious"),
  );

  for (const alert of worthInterrupting) {
    new Notification(alert.title, {
      body: alert.body,
      tag: alert.dedupeKey,
      icon: "/icon.svg",
    });
  }

  return worthInterrupting.length;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}
