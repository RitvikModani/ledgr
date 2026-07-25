"use client";

import type { ReactNode } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CriticalIcon,
  InfoIcon,
  SeriousIcon,
  WarningIcon,
} from "@/components/ui/icons";
import type { AlertSeverity } from "@/lib/db/types";

const STATUS_ICON = {
  good: CheckCircleIcon,
  warning: WarningIcon,
  serious: SeriousIcon,
  critical: CriticalIcon,
} as const;

const STATUS_COLOR = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const;

export function StatusMark({
  severity,
  label,
}: {
  severity: AlertSeverity;
  label: string;
}) {
  const Icon = STATUS_ICON[severity];
  return (
    // Icon and text together, always. Two of these four colours sit below 3:1
    // on the light surface by design; the pairing is what carries the meaning.
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-secondary">
      <span style={{ color: STATUS_COLOR[severity] }}>
        <Icon size={14} />
      </span>
      {label}
    </span>
  );
}

export interface Delta {
  /** Signed fractional change, e.g. 0.12 for +12%. */
  value: number;
  label: string;
  /** Whether an increase is a good thing. Spending up is bad; income up is good. */
  higherIsBetter: boolean;
}

/**
 * A single headline number.
 *
 * Deliberately not a chart: a lone figure with a comparison is the right form
 * for "what is my savings rate", and drawing a two-point line instead would be
 * decoration. Direction is carried by an arrow *and* the delta text, never by
 * red-vs-green alone.
 */
export function StatTile({
  label,
  value,
  hint,
  delta,
  status,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: Delta | null;
  status?: { severity: AlertSeverity; label: string };
}) {
  const improving = delta ? (delta.higherIsBetter ? delta.value > 0 : delta.value < 0) : false;

  return (
    <section className="rounded-xl border border-hairline bg-surface p-4">
      <h3 className="text-xs font-medium text-ink-secondary">{label}</h3>

      <p className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
        {value}
      </p>

      {delta ? (
        <p
          className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${
            improving ? "text-text-good" : "text-text-bad"
          }`}
        >
          {delta.value >= 0 ? <ArrowUpIcon size={13} /> : <ArrowDownIcon size={13} />}
          {Math.abs(delta.value * 100).toFixed(0)}% {delta.label}
        </p>
      ) : null}

      {status ? (
        <p className="mt-1.5">
          <StatusMark severity={status.severity} label={status.label} />
        </p>
      ) : null}

      {hint ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
          <span className="mt-px shrink-0">
            <InfoIcon size={12} />
          </span>
          {hint}
        </p>
      ) : null}
    </section>
  );
}
