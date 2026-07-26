"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { StatusMark } from "@/components/charts/StatTile";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { AlertsIcon, CheckCircleIcon, MailIcon } from "@/components/ui/icons";
import { db } from "@/lib/db/db";
import { acknowledgeAlert, acknowledgeAll } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { evaluateAlerts } from "@/lib/alerts/engine";
import { SEVERITY_ORDER } from "@/lib/alerts/rules";
import { sendDigest } from "@/lib/alerts/digest";
import { DIGESTS_AVAILABLE } from "@/lib/basePath";
import type { Alert } from "@/lib/db/types";

const SEVERITY_LABEL = {
  critical: "Needs attention now",
  serious: "Important",
  warning: "Worth a look",
  good: "Heads up",
} as const;

export default function AlertsPage() {
  const data = useLedgrData();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const alerts = useLiveQuery(
    async () => db().alerts.orderBy("createdAt").reverse().toArray(),
    [],
  );

  async function refresh() {
    setBusy("refresh");
    setMessage(null);
    try {
      const result = await evaluateAlerts(data);
      setMessage(
        result.created === 0 && result.resolved === 0
          ? "Nothing has changed since the last check."
          : `${result.created} new, ${result.resolved} no longer apply.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function emailDigest() {
    setBusy("digest");
    setMessage(null);
    try {
      const result = await sendDigest(data.settings, alerts ?? []);
      setMessage(result.message);
    } finally {
      setBusy(null);
    }
  }

  if (data.loading || alerts === undefined) {
    return (
      <>
        <PageHeader title="Alerts" lede="What needs your attention." />
        <Skeleton className="h-64" />
      </>
    );
  }

  const open = alerts.filter((a) => !a.acknowledgedAt);
  const acknowledged = alerts.filter((a) => a.acknowledgedAt);
  const grouped = groupBySeverity(open);

  return (
    <>
      <PageHeader
        title="Alerts"
        lede="Ledgr checks your budgets, goals, cash flow and portfolio against what your profile says you are aiming for."
        actions={
          <>
            <Button onClick={refresh} disabled={busy !== null}>
              {busy === "refresh" ? "Checking…" : "Check again"}
            </Button>
            {DIGESTS_AVAILABLE && data.settings.notifications.emailDigest && open.length > 0 ? (
              <Button onClick={emailDigest} disabled={busy !== null}>
                <MailIcon size={16} />
                {busy === "digest" ? "Sending…" : "Email me this"}
              </Button>
            ) : null}
            {open.length > 0 ? (
              <Button variant="ghost" onClick={() => acknowledgeAll()}>
                Dismiss all
              </Button>
            ) : null}
          </>
        }
      />

      {message ? (
        <div className="mb-6">
          <Callout>
            <p>{message}</p>
          </Callout>
        </div>
      ) : null}

      {open.length === 0 ? (
        <EmptyState
          icon={alerts.length === 0 ? <AlertsIcon size={28} /> : <CheckCircleIcon size={28} />}
          title={alerts.length === 0 ? "No alerts yet" : "Nothing needs your attention"}
          body={
            alerts.length === 0
              ? "Once you have imported some transactions and answered a few profile questions, Ledgr will watch for overspending, thin runway, goals falling behind, unusual charges and allocation drift."
              : "Everything Ledgr checks is currently within the bounds your profile sets. It will tell you when that changes."
          }
          action={
            alerts.length === 0 ? (
              <>
                <LinkButton href="/import" variant="primary">
                  Import a statement
                </LinkButton>
                <Button onClick={refresh}>Check now</Button>
              </>
            ) : (
              <Button onClick={refresh}>Check again</Button>
            )
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {(Object.keys(SEVERITY_LABEL) as Array<keyof typeof SEVERITY_LABEL>)
            .filter((severity) => grouped[severity]?.length)
            .map((severity) => (
              <section key={severity}>
                <h2 className="mb-3 text-sm font-semibold">
                  {SEVERITY_LABEL[severity]}
                  <span className="ml-2 font-normal text-ink-muted">
                    {grouped[severity].length}
                  </span>
                </h2>
                <ul className="flex flex-col gap-3">
                  {grouped[severity].map((alert) => (
                    <AlertCard key={alert.id} alert={alert} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {acknowledged.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-secondary">
            Dismissed
            <span className="ml-2 font-normal text-ink-muted">{acknowledged.length}</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {acknowledged.slice(0, 10).map((alert) => (
              <li key={alert.id} className="text-xs text-ink-muted">
                {alert.title}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">
            These stay dismissed until the condition changes. If it goes away and comes
            back, Ledgr will raise it again.
          </p>
        </section>
      ) : null}
    </>
  );
}

function AlertCard({ alert }: { alert: Alert }) {
  return (
    <Card as="li">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusMark severity={alert.severity} label={SEVERITY_LABEL[alert.severity]} />
          <h3 className="mt-1.5 text-sm font-semibold">{alert.title}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-secondary">
            {alert.body}
          </p>
        </div>

        <div className="flex shrink-0 gap-2">
          {alert.href ? (
            <Link
              href={alert.href}
              className="inline-flex items-center rounded-lg border border-hairline-strong px-3 py-1.5 text-xs font-medium transition-colors hover:bg-wash"
            >
              Go there
            </Link>
          ) : null}
          <Button
            variant="ghost"
            className="px-2.5 py-1.5 text-xs"
            onClick={() => alert.id && acknowledgeAlert(alert.id)}
          >
            Dismiss
          </Button>
        </div>
      </div>
    </Card>
  );
}

function groupBySeverity(alerts: Alert[]): Record<string, Alert[]> {
  const grouped: Record<string, Alert[]> = {};
  for (const alert of alerts) {
    (grouped[alert.severity] ??= []).push(alert);
  }
  for (const list of Object.values(grouped)) {
    list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
  return grouped;
}
