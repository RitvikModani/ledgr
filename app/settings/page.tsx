"use client";

import { useState } from "react";
import { AmountInput, ChoiceGroup, Field, TextInput, Toggle } from "@/components/ui/fields";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { DownloadIcon, TrashIcon } from "@/components/ui/icons";
import { exportAll, saveSettings, wipeAll } from "@/lib/db/db";
import { deleteImport, listImports } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { requestNotificationPermission } from "@/lib/alerts/digest";
import { formatDate, toISODate } from "@/lib/format/date";
import { useLiveQuery } from "dexie-react-hooks";

export default function SettingsPage() {
  const { settings, loading } = useLedgrData();
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const imports = useLiveQuery(() => listImports(), [], []);

  async function download() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `ledgr-export-${toISODate(new Date())}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  async function enablePush(enabled: boolean) {
    if (!enabled) {
      await saveSettings({ notifications: { ...settings.notifications, browserPush: false } });
      return;
    }

    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      setNotice(
        "Your browser refused notification permission. You can change that in the site settings for this page.",
      );
      return;
    }

    setNotice(null);
    await saveSettings({ notifications: { ...settings.notifications, browserPush: true } });
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Settings" lede="Currency, notifications and your data." />
        <Skeleton className="h-96" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        lede="How Ledgr behaves, and what happens to your data."
      />

      {notice ? (
        <div className="mb-6">
          <Callout tone="warning">
            <p>{notice}</p>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Formatting follows the currency — rupees group the Indian way.">
            Money
          </CardTitle>

          <div className="flex flex-col gap-5">
            <Field label="Currency">
              <ChoiceGroup
                name="Currency"
                value={settings.currency}
                options={[
                  { value: "INR", label: "₹ Rupee" },
                  { value: "USD", label: "$ Dollar" },
                  { value: "EUR", label: "€ Euro" },
                  { value: "GBP", label: "£ Pound" },
                ]}
                onChange={(currency) => saveSettings({ currency })}
              />
            </Field>

            <Field
              label="Cash and deposits you hold"
              hint="Statements show what flowed, never what is already banked. This is what runway and the emergency-fund check are measured against."
            >
              <AmountInput
                value={settings.liquidSavings}
                onChange={(liquidSavings) => saveSettings({ liquidSavings })}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle hint="Ledgr checks your plan when you open it. This is how it tells you.">
            Alerts
          </CardTitle>

          <div className="flex flex-col gap-5">
            <Toggle
              checked={settings.notifications.browserPush}
              onChange={enablePush}
              label="Browser notifications"
              hint="Only for things that genuinely warrant interrupting you — critical and important alerts. A notification for a routine bill is how people end up switching these off entirely."
            />

            <div className="border-t border-hairline pt-5">
              <Toggle
                checked={settings.notifications.emailDigest}
                onChange={(emailDigest) =>
                  saveSettings({ notifications: { ...settings.notifications, emailDigest } })
                }
                label="Email digests"
                hint="This is the only feature that sends anything off your device. It emails the alert text above — never your transactions — to the address below."
              />

              {settings.notifications.emailDigest ? (
                <div className="mt-4 flex flex-col gap-4 pl-7">
                  <Field label="Send to" htmlFor="digest-email">
                    <TextInput
                      id="digest-email"
                      type="email"
                      placeholder="you@example.com"
                      value={settings.notifications.email}
                      onChange={(event) =>
                        saveSettings({
                          notifications: {
                            ...settings.notifications,
                            email: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>

                  <Field label="How often">
                    <ChoiceGroup
                      name="Digest frequency"
                      value={settings.notifications.digestFrequency}
                      options={[
                        { value: "weekly", label: "Weekly" },
                        { value: "monthly", label: "Monthly" },
                      ]}
                      onChange={(digestFrequency) =>
                        saveSettings({
                          notifications: { ...settings.notifications, digestFrequency },
                        })
                      }
                    />
                  </Field>

                  <p className="text-xs leading-relaxed text-ink-muted">
                    Because Ledgr has no accounts, digests are sent when you open the app and
                    one is due, rather than on a server schedule. If the deployment has no
                    mail service configured, the Alerts page will say so rather than failing
                    quietly.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle hint="Everything Ledgr holds about you lives in this browser.">
            Your data
          </CardTitle>

          <p className="mb-4 text-sm leading-relaxed text-ink-secondary">
            There is no account and no server copy. That is the point — but it also means
            your data is exactly as durable as this browser profile. Clearing site data
            deletes it, and nobody can recover it for you. Export it somewhere safe.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button onClick={download}>
              <DownloadIcon size={16} /> Export everything
            </Button>

            {confirmWipe ? (
              <>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await wipeAll();
                    setConfirmWipe(false);
                    setNotice("Everything has been deleted.");
                  }}
                >
                  Yes, delete it all
                </Button>
                <Button variant="ghost" onClick={() => setConfirmWipe(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmWipe(true)}>
                <TrashIcon size={16} /> Delete everything
              </Button>
            )}
          </div>

          {confirmWipe ? (
            <p className="mt-3 text-xs leading-relaxed text-text-bad">
              This removes every transaction, goal, holding, budget and answer. It cannot be
              undone, and there is no backup unless you made one.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardTitle hint="Remove an import and every transaction it brought in goes with it.">
            Imports
          </CardTitle>

          {imports.length === 0 ? (
            <p className="text-sm text-ink-secondary">Nothing imported yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline">
              {imports.map((batch) => (
                <li
                  key={batch.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{batch.fileName}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {batch.sheetName} · {batch.rowsImported} rows ·{" "}
                      {formatDate(toISODate(new Date(batch.importedAt)))}
                      {batch.rowsDuplicate > 0 ? ` · ${batch.rowsDuplicate} skipped` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => deleteImport(batch.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
