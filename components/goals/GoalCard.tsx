"use client";

import { StatusMark } from "@/components/charts/StatTile";
import { Button, Card } from "@/components/ui/primitives";
import { formatCurrency } from "@/lib/format/currency";
import { formatDate } from "@/lib/format/date";
import {
  GOAL_STATUS_LABEL,
  GOAL_STATUS_SEVERITY,
  type GoalAssessment,
} from "@/lib/planning/goals";

const KIND_LABEL: Record<string, string> = {
  "emergency-fund": "Emergency fund",
  home: "Home",
  retirement: "Retirement",
  education: "Education",
  vehicle: "Vehicle",
  travel: "Travel",
  "debt-payoff": "Debt payoff",
  custom: "Custom",
};

/**
 * Progress meter rather than a chart.
 *
 * One value against one target is a meter's job; drawing it as a bar chart with
 * an axis would be decoration around a single number.
 */
export function GoalCard({
  assessment,
  allocated,
  onEdit,
  onDelete,
}: {
  assessment: GoalAssessment;
  allocated?: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { goal, progress, status, requiredMonthly, monthlyShortfall, monthsLate } = assessment;
  const severity = GOAL_STATUS_SEVERITY[status];

  return (
    <Card as="li">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{goal.name}</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {KIND_LABEL[goal.kind] ?? "Custom"} · by {formatDate(goal.targetDate)}
          </p>
        </div>
        <StatusMark severity={severity} label={GOAL_STATUS_LABEL[status]} />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold tabular">{formatCurrency(goal.currentAmount)}</span>
          <span className="text-xs text-ink-secondary tabular">
            of {formatCurrency(assessment.targetAtMaturity)}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-wash"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${goal.name} progress`}
        >
          <div
            className="h-full rounded-full bg-series-1 transition-all"
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          {(progress * 100).toFixed(0)}% there
          {goal.inflationRate > 0
            ? ` · target adjusted for ${(goal.inflationRate * 100).toFixed(0)}% inflation`
            : null}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-ink-muted">You put in</dt>
          <dd className="mt-0.5 font-semibold tabular">
            {formatCurrency(goal.monthlyContribution)}/mo
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Needs</dt>
          <dd className="mt-0.5 font-semibold tabular">
            {formatCurrency(requiredMonthly)}/mo
          </dd>
        </div>
      </dl>

      {monthlyShortfall > 0 ? (
        <p className="mt-3 rounded-lg bg-wash px-3 py-2 text-xs leading-relaxed text-ink-secondary">
          Short by <strong>{formatCurrency(monthlyShortfall)}</strong> a month.{" "}
          {monthsLate === null
            ? "At the current contribution it does not get there."
            : `At this rate it arrives about ${monthsLate} month${monthsLate === 1 ? "" : "s"} late.`}
        </p>
      ) : null}

      {allocated !== undefined && allocated < requiredMonthly ? (
        <p className="mt-2 text-xs text-ink-muted">
          Your surplus covers {formatCurrency(allocated)} of this.
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button onClick={onEdit}>Edit</Button>
        <Button variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  );
}
