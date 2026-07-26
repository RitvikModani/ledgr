"use client";

import { useMemo, useState } from "react";
import { ProjectionChart } from "@/components/charts/charts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { StatTile } from "@/components/charts/StatTile";
import { AmountInput, Field, Slider } from "@/components/ui/fields";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { PlanIcon, UndoIcon } from "@/components/ui/icons";
import { replaceAutoBudgets, saveBudget } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { categoryTotals, snapshot } from "@/lib/analytics/aggregate";
import { autoBudget } from "@/lib/planning/budget";
import { compareScenario, EMPTY_SCENARIO } from "@/lib/planning/scenario";
import { formatCurrency, formatPercent } from "@/lib/format/currency";
import type { Scenario } from "@/lib/db/types";

type Draft = Omit<Scenario, "id" | "name" | "createdAt">;

export default function PlanPage() {
  const { transactions, goals, budgets, loading } = useLedgrData();
  const [draft, setDraft] = useState<Draft>(EMPTY_SCENARIO);

  const model = useMemo(() => {
    const stats = snapshot(transactions);
    const totals = categoryTotals(transactions);
    const derived = autoBudget(transactions);

    const monthCount = Math.max(1, stats.months.length);
    const categorySpend = Object.fromEntries(
      totals.map((t) => [t.category, t.amount / monthCount]),
    );

    const comparison = compareScenario(
      {
        monthlyIncome: stats.medianMonthlyIncome,
        monthlyExpense: stats.medianMonthlyExpense,
        categorySpend,
        goals,
      },
      draft,
    );

    return { stats, totals, derived, categorySpend, comparison };
  }, [transactions, goals, draft]);

  if (loading) {
    return (
      <>
        <PageHeader title="Plan" lede="Budget, projections and what-ifs." />
        <Skeleton className="h-80" />
      </>
    );
  }

  if (transactions.length === 0) {
    return (
      <>
        <PageHeader title="Plan" lede="Budget, projections and what-ifs." />
        <EmptyState
          icon={<PlanIcon size={28} />}
          title="Nothing to plan around yet"
          body="Ledgr builds your budget from what you actually spend rather than from a template, so it needs a few months of transactions first."
          action={
            <LinkButton href="/import" variant="primary">
              Import a statement
            </LinkButton>
          }
        />
      </>
    );
  }

  const { stats, derived, categorySpend, comparison } = model;
  const { baseline, scenario } = comparison;
  const changed = JSON.stringify(draft) !== JSON.stringify(EMPTY_SCENARIO);

  const projectionPoints = baseline.projection.map((row, i) => ({
    month: row.month,
    baseline: Math.round(row.value),
    scenario: Math.round(scenario.projection[i]?.value ?? row.value),
  }));

  // The five biggest categories are where a cut actually moves the number;
  // a slider for a category costing 400 rupees a month is noise.
  const cuttable = model.totals.slice(0, 5);

  return (
    <>
      <PageHeader
        title="Plan"
        lede="A budget from your own spending, and a way to test what would change if something changed."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Typical income" value={formatCurrency(stats.medianMonthlyIncome)} />
        <StatTile label="Typical spending" value={formatCurrency(stats.medianMonthlyExpense)} />
        <StatTile
          label="Surplus"
          value={formatCurrency(stats.monthlySurplus)}
          hint="What is left to put toward goals."
        />
        <StatTile label="Savings rate" value={formatPercent(stats.savingsRate, 0)} />
      </div>

      {/* ---------------------------------------------------------------- */}

      <Card className="mb-6">
        <CardTitle
          hint={`Derived from the median of your last ${derived.monthsObserved} months. Medians, not averages — one expensive month should not become your budget.`}
          actions={
            <Button
              onClick={() =>
                replaceAutoBudgets(
                  derived.envelopes.map((e) => ({
                    category: e.category,
                    monthlyLimit: e.monthlyLimit,
                  })),
                )
              }
            >
              Use these
            </Button>
          }
        >
          Suggested budget — {formatCurrency(derived.totalLimit)} a month
        </CardTitle>

        {derived.envelopes.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            Not enough spending history to suggest envelopes yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline">
            {derived.envelopes.map((envelope) => {
              const existing = budgets.find((b) => b.category === envelope.category);
              return (
                <li
                  key={envelope.category}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{envelope.category}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      You usually spend {formatCurrency(envelope.typical)}
                      {envelope.trimmed > 0
                        ? ` · trimmed by ${formatCurrency(envelope.trimmed)}`
                        : " · budgeted at cost, since this is not discretionary"}
                      {envelope.thin ? " · thin history, treat as a guess" : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="w-36">
                      <AmountInput
                        value={existing?.monthlyLimit ?? envelope.monthlyLimit}
                        onChange={(limit) => saveBudget(envelope.category, limit, false)}
                      />
                    </div>
                    {existing && !existing.auto ? (
                      <span className="text-xs text-ink-muted">yours</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}

      <Card className="mb-6">
        <CardTitle
          hint="Move anything and watch the projection below move with it. Nothing here changes your data."
          actions={
            changed ? (
              <Button onClick={() => setDraft(EMPTY_SCENARIO)}>
                <UndoIcon size={14} /> Reset
              </Button>
            ) : undefined
          }
        >
          What if…
        </CardTitle>

        <div className="grid gap-6 lg:grid-cols-2">
          <Field
            label="Income changes by"
            htmlFor="s-income"
            hint="A raise, a job change, or a pay cut."
          >
            <Slider
              id="s-income"
              min={-0.5}
              max={1}
              step={0.01}
              value={draft.incomeChangePct}
              onChange={(incomeChangePct) => setDraft((d) => ({ ...d, incomeChangePct }))}
              format={(value) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(0)}%`}
            />
          </Field>

          <Field
            label="Put in extra each month"
            htmlFor="s-extra"
            hint="On top of what your surplus already covers."
          >
            <AmountInput
              id="s-extra"
              value={draft.extraMonthlyContribution}
              onChange={(extraMonthlyContribution) =>
                setDraft((d) => ({ ...d, extraMonthlyContribution }))
              }
            />
          </Field>

          <Field
            label="Shift every goal date by"
            htmlFor="s-shift"
            hint="Later dates need smaller contributions; earlier dates need more."
          >
            <Slider
              id="s-shift"
              min={-24}
              max={60}
              step={1}
              value={draft.targetDateShiftMonths}
              onChange={(targetDateShiftMonths) =>
                setDraft((d) => ({ ...d, targetDateShiftMonths }))
              }
              format={(value) =>
                value === 0 ? "no change" : `${value > 0 ? "+" : ""}${value} months`
              }
            />
          </Field>

          <Field
            label="Assume returns of"
            htmlFor="s-return"
            hint="Overrides every goal's own assumption, so you can see how much the plan depends on it."
          >
            <Slider
              id="s-return"
              min={0}
              max={0.18}
              step={0.005}
              value={draft.returnRateOverride ?? 0.12}
              onChange={(returnRateOverride) =>
                setDraft((d) => ({ ...d, returnRateOverride }))
              }
              format={(value) => formatPercent(value, 1)}
            />
          </Field>
        </div>

        {cuttable.length > 0 ? (
          <div className="mt-6 border-t border-hairline pt-5">
            <p className="mb-4 text-sm font-medium">Spend less on…</p>
            <div className="grid gap-5 lg:grid-cols-2">
              {cuttable.map((category) => (
                <Field
                  key={category.category}
                  label={category.category}
                  htmlFor={`cut-${category.category}`}
                  hint={`Usually ${formatCurrency(categorySpend[category.category] ?? 0)} a month`}
                >
                  <Slider
                    id={`cut-${category.category}`}
                    min={0}
                    max={0.6}
                    step={0.05}
                    value={draft.categoryCuts[category.category] ?? 0}
                    onChange={(cut) =>
                      setDraft((d) => ({
                        ...d,
                        categoryCuts: { ...d.categoryCuts, [category.category]: cut },
                      }))
                    }
                    format={(value) =>
                      value === 0
                        ? "no cut"
                        : `−${(value * 100).toFixed(0)}% · ${formatCurrency(
                            (categorySpend[category.category] ?? 0) * value,
                          )}`
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {changed ? (
        <div className="mb-6">
          <Callout title="What that would do">
            <p>
              Your surplus goes from {formatCurrency(baseline.monthlySurplus)} to{" "}
              <strong>{formatCurrency(scenario.monthlySurplus)}</strong> a month, and your
              savings rate from {formatPercent(baseline.savingsRate, 0)} to{" "}
              <strong>{formatPercent(scenario.savingsRate, 0)}</strong>.
            </p>
            <p>
              Over the same period you would end with{" "}
              <strong>{formatCurrency(scenario.corpusAtHorizon)}</strong> instead of{" "}
              {formatCurrency(baseline.corpusAtHorizon)} — a difference of{" "}
              {formatCurrency(Math.abs(comparison.corpusDelta))}
              {comparison.monthsEarlier
                ? `, and you would reach today's projected total about ${comparison.monthsEarlier} months sooner`
                : ""}
              .
            </p>
            {comparison.goalsDelta !== 0 ? (
              <p>
                {comparison.goalsDelta > 0
                  ? `${comparison.goalsDelta} more goal${comparison.goalsDelta === 1 ? "" : "s"} would be on track.`
                  : `${Math.abs(comparison.goalsDelta)} fewer goal${Math.abs(comparison.goalsDelta) === 1 ? "" : "s"} would be on track.`}
              </p>
            ) : null}
          </Callout>
        </div>
      ) : null}

      {goals.length > 0 ? (
        <ProjectionChart
          title="Now versus what-if"
          hint={
            changed
              ? "Total across every goal. Both lines share one axis, so the gap between them is the difference."
              : "Total across every goal. Move a slider above to lay a second line over this one."
          }
          points={projectionPoints}
          // Only two series once something has actually changed. Drawing an
          // identical scenario line on top of the baseline would hide it while
          // the legend claimed two.
          series={
            changed
              ? [
                  { key: "baseline", label: "As things are" },
                  { key: "scenario", label: "Under this scenario" },
                ]
              : [{ key: "baseline", label: "As things are" }]
          }
        />
      ) : (
        <ChartFrame
          title="Now versus what-if"
          tableRows={[]}
          tableColumns={[]}
          empty="Add a goal and the simulator has something to project toward."
        >
          <div />
        </ChartFrame>
      )}

      <div className="mt-6">
        <LinkButton href="/goals">Manage your goals</LinkButton>
      </div>
    </>
  );
}
