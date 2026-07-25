"use client";

import { useMemo, useState } from "react";
import { GoalCard } from "@/components/goals/GoalCard";
import { GoalEditor } from "@/components/goals/GoalEditor";
import { StatTile } from "@/components/charts/StatTile";
import { ProjectionChart } from "@/components/charts/charts";
import {
  Button,
  Callout,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { GoalsIcon, PlusIcon } from "@/components/ui/icons";
import { deleteGoal, saveGoal } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { snapshot } from "@/lib/analytics/aggregate";
import { allocateSurplus, project } from "@/lib/planning/goals";
import { emergencyFundMonths } from "@/lib/interview/risk";
import { formatCurrency } from "@/lib/format/currency";
import { addCalendarMonths, todayISO } from "@/lib/format/date";
import type { Goal } from "@/lib/db/types";

export default function GoalsPage() {
  const { goals, transactions, interview, loading } = useLedgrData();
  const [editing, setEditing] = useState<Goal | null | "new">(null);

  const stats = useMemo(() => snapshot(transactions), [transactions]);

  const allocation = useMemo(
    () => allocateSurplus(goals, stats.monthlySurplus),
    [goals, stats.monthlySurplus],
  );

  const projection = useMemo(() => {
    if (goals.length === 0) return null;

    const totalCurrent = goals.reduce((sum, g) => sum + g.currentAmount, 0);
    const totalContribution = goals.reduce((sum, g) => sum + g.monthlyContribution, 0);
    const avgReturn =
      goals.reduce((sum, g) => sum + g.expectedAnnualReturn, 0) / goals.length;

    const months = Math.max(
      12,
      ...allocation.allocations.map((a) => a.assessment.monthsRemaining),
    );

    const current = project({
      startingAmount: totalCurrent,
      monthlyContribution: totalContribution,
      annualReturn: avgReturn,
      months,
    });

    const needed = project({
      startingAmount: totalCurrent,
      monthlyContribution: allocation.totalRequired,
      annualReturn: avgReturn,
      months,
    });

    return current.map((row, i) => ({
      month: row.month,
      current: Math.round(row.value),
      needed: Math.round(needed[i]?.value ?? 0),
    }));
  }, [goals, allocation]);

  async function handleSave(goal: Goal) {
    await saveGoal(goal);
    setEditing(null);
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Goals" lede="What you are saving toward." />
        <Skeleton className="h-64" />
      </>
    );
  }

  if (editing !== null) {
    return (
      <>
        <PageHeader title="Goals" lede="What you are saving toward." />
        <GoalEditor
          goal={editing === "new" ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      </>
    );
  }

  if (goals.length === 0) {
    return (
      <>
        <PageHeader title="Goals" lede="What you are saving toward." />
        <EmptyState
          icon={<GoalsIcon size={28} />}
          title="No goals yet"
          body="A goal is a number and a date. Once Ledgr has both, it can work out what you need to put aside each month, whether you are on track, and how the rest of the plan should be arranged around it."
          action={
            <>
              <Button variant="primary" onClick={() => setEditing("new")}>
                Add your first goal
              </Button>
              {stats.medianMonthlyExpense > 0 ? (
                <Button onClick={() => setEditing(suggestEmergencyFund(stats.medianMonthlyExpense, emergencyFundMonths(interview)))}>
                  Start with an emergency fund
                </Button>
              ) : null}
            </>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Goals"
        lede="What you are saving toward, and whether your current contributions get you there."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <PlusIcon size={16} /> New goal
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Monthly surplus"
          value={formatCurrency(stats.monthlySurplus)}
          hint="Typical income less typical spending."
        />
        <StatTile
          label="Your goals need"
          value={formatCurrency(allocation.totalRequired)}
          hint="Total monthly contribution to hit every date."
        />
        <StatTile
          label="Currently contributing"
          value={formatCurrency(goals.reduce((sum, g) => sum + g.monthlyContribution, 0))}
        />
        <StatTile
          label="Goals on track"
          value={`${allocation.allocations.filter((a) => ["on-track", "achieved"].includes(a.assessment.status)).length} of ${goals.length}`}
        />
      </div>

      {allocation.constrained ? (
        <div className="mb-6">
          <Callout tone="warning" title="Your surplus does not cover every goal">
            <p>
              Hitting every date would take {formatCurrency(allocation.totalRequired)} a
              month, and you have about {formatCurrency(stats.monthlySurplus)} spare. Ledgr
              funds higher priorities in full rather than spreading the surplus thinly —
              partly funding five goals means missing five dates.
            </p>
            <p>
              Either push out a target date, lower a target, find more surplus on the{" "}
              <a href="/plan" className="font-medium text-series-1 underline">
                Plan page
              </a>
              , or accept that the lower-priority goals arrive late.
            </p>
          </Callout>
        </div>
      ) : null}

      <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {allocation.allocations.map(({ goal, assessment, allocated }) => (
          <GoalCard
            key={goal.id ?? goal.name}
            assessment={assessment}
            allocated={allocated}
            onEdit={() => setEditing(goal)}
            onDelete={() => goal.id && deleteGoal(goal.id)}
          />
        ))}
      </ul>

      {projection ? (
        <div className="mt-6">
          <ProjectionChart
            title="All goals together"
            hint="Total corpus across every goal, at what you contribute now against what the dates require."
            points={projection}
            series={[
              { key: "current", label: "At your current contribution" },
              { key: "needed", label: "At what the dates need" },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <LinkButton href="/invest">See how to invest toward these</LinkButton>
      </div>
    </>
  );
}

/** Pre-fills a goal from the interview rather than making the user do the maths. */
function suggestEmergencyFund(monthlyExpense: number, months: number): Goal {
  return {
    name: `${months} months of expenses`,
    kind: "emergency-fund",
    targetAmount: Math.round((monthlyExpense * months) / 1000) * 1000,
    currentAmount: 0,
    targetDate: addCalendarMonths(todayISO(), 24),
    priority: "high",
    expectedAnnualReturn: 0.06,
    inflationRate: 0.05,
    monthlyContribution: 0,
    createdAt: Date.now(),
  };
}
