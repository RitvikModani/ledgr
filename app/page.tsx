"use client";

import { useMemo, useState } from "react";
import {
  BalanceChart,
  BudgetVarianceChart,
  CashflowChart,
  CategoryChart,
  CategoryTrendChart,
  type BudgetVariance,
} from "@/components/charts/charts";
import { StatTile } from "@/components/charts/StatTile";
import {
  Button,
  Callout,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { ImportIcon } from "@/components/ui/icons";
import { loadSampleData } from "@/lib/import/sample";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import {
  balanceSeries,
  categoryTotals,
  categoryTrend,
  monthlyTotals,
  runwayMonths,
  snapshot,
} from "@/lib/analytics/aggregate";
import { formatCompactCurrency, formatCurrency, formatPercent, percentChange } from "@/lib/format/currency";
import { formatMonthKey } from "@/lib/format/date";
import type { AlertSeverity } from "@/lib/db/types";

export default function DashboardPage() {
  const { transactions, budgets, settings, interview, loading } = useLedgrData();
  const [sampleState, setSampleState] = useState<"idle" | "loading" | "failed">("idle");

  const analysis = useMemo(() => {
    const months = monthlyTotals(transactions);
    const stats = snapshot(transactions);
    const totals = categoryTotals(transactions);
    const trend = categoryTrend(transactions, 7);
    const balance = balanceSeries(transactions);

    const latest = months.at(-1);
    const previous = months.at(-2);

    // Liquid savings is the interview's number when the user gave one, since
    // statements only show what flowed, never what is already banked.
    const liquid = interview.liquidSavings || settings.liquidSavings;
    const runway = runwayMonths(liquid, stats.medianMonthlyExpense);

    const spendByCategory = new Map(totals.map((t) => [t.category, t.amount]));
    const monthsCounted = Math.max(1, months.length);
    const variance: BudgetVariance[] = budgets
      .map((budget) => {
        const actual = (spendByCategory.get(budget.category) ?? 0) / monthsCounted;
        return {
          category: budget.category,
          budget: budget.monthlyLimit,
          actual,
          variance: budget.monthlyLimit - actual,
        };
      })
      .sort((a, b) => a.variance - b.variance);

    return { months, stats, totals, trend, balance, latest, previous, liquid, runway, variance };
  }, [transactions, budgets, settings.liquidSavings, interview.liquidSavings]);

  if (loading) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Where your money went." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </>
    );
  }

  if (transactions.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" lede="Where your money went." />
        {sampleState === "failed" ? (
          <div className="mb-6">
            <Callout tone="warning">
              <p>
                The sample data could not be loaded. Importing your own spreadsheet still
                works.
              </p>
            </Callout>
          </div>
        ) : null}

        <EmptyState
          icon={<ImportIcon size={28} />}
          title="Nothing imported yet"
          body="Bring in a bank statement or an expense sheet and Ledgr will chart where your money goes, then build a plan around it. Your file is read here in the browser and never uploaded."
          action={
            <>
              <LinkButton href="/import" variant="primary">
                Import a spreadsheet
              </LinkButton>
              <Button
                disabled={sampleState === "loading"}
                data-testid="load-sample"
                onClick={async () => {
                  setSampleState("loading");
                  try {
                    await loadSampleData();
                    setSampleState("idle");
                  } catch {
                    setSampleState("failed");
                  }
                }}
              >
                {sampleState === "loading" ? "Loading…" : "Try it with sample data"}
              </Button>
              <LinkButton href="/interview">Answer a few questions first</LinkButton>
            </>
          }
        />
      </>
    );
  }

  const { stats, latest, previous, runway, liquid } = analysis;

  const spendDelta =
    latest && previous ? percentChange(latest.expense, previous.expense) : null;
  const incomeDelta =
    latest && previous ? percentChange(latest.income, previous.income) : null;

  const runwayStatus = runwayStatusFor(runway, interview.answered.length > 0 || liquid > 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        lede={
          latest
            ? `Through ${formatMonthKey(latest.month)}, across ${transactions.length.toLocaleString("en-IN")} transactions.`
            : "Where your money went."
        }
        actions={<LinkButton href="/import">Import more</LinkButton>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Typical monthly income"
          value={formatCurrency(stats.medianMonthlyIncome)}
          delta={
            incomeDelta === null
              ? null
              : { value: incomeDelta, label: "last month vs the one before", higherIsBetter: true }
          }
          hint="Median of your complete months, so one bonus does not skew it."
        />

        <StatTile
          label="Typical monthly spending"
          value={formatCurrency(stats.medianMonthlyExpense)}
          delta={
            spendDelta === null
              ? null
              : { value: spendDelta, label: "last month vs the one before", higherIsBetter: false }
          }
        />

        <StatTile
          label="Savings rate"
          value={formatPercent(stats.savingsRate, 0)}
          status={savingsRateStatus(stats.savingsRate)}
          hint="Income left after spending, before investing."
        />

        <StatTile
          label="Runway"
          value={
            Number.isFinite(runway) && liquid > 0
              ? `${runway.toFixed(1)} months`
              : "Not known yet"
          }
          status={runwayStatus ?? undefined}
          hint={
            liquid > 0
              ? `${formatCompactCurrency(liquid)} in savings at your usual monthly spend.`
              : "Tell Ledgr what you hold in savings and it can work this out."
          }
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <CashflowChart months={analysis.months} />
        <CategoryChart totals={analysis.totals} />
        <CategoryTrendChart
          points={analysis.trend.points}
          categories={analysis.trend.categories}
        />
        <BalanceChart
          points={analysis.balance.points}
          fromStatement={analysis.balance.fromStatement}
        />
        {analysis.variance.length > 0 ? (
          <div className="xl:col-span-2">
            <BudgetVarianceChart rows={analysis.variance} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function savingsRateStatus(rate: number): { severity: AlertSeverity; label: string } {
  if (rate >= 0.3) return { severity: "good", label: "Strong" };
  if (rate >= 0.15) return { severity: "warning", label: "Could be higher" };
  if (rate >= 0) return { severity: "serious", label: "Thin" };
  return { severity: "critical", label: "Spending more than you earn" };
}

function runwayStatusFor(
  months: number,
  known: boolean,
): { severity: AlertSeverity; label: string } | null {
  if (!known || !Number.isFinite(months)) return null;
  if (months >= 6) return { severity: "good", label: "Comfortable" };
  if (months >= 3) return { severity: "warning", label: "Below six months" };
  if (months >= 1) return { severity: "serious", label: "Under three months" };
  return { severity: "critical", label: "Under a month" };
}
