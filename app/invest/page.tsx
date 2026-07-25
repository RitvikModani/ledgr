"use client";

import { useMemo } from "react";
import { StatTile, StatusMark } from "@/components/charts/StatTile";
import { ChartFrame } from "@/components/charts/ChartFrame";
import {
  AdviceDisclaimer,
  Callout,
  Card,
  CardTitle,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { snapshot } from "@/lib/analytics/aggregate";
import { assessRisk, emergencyFundMonths, RISK_LABEL } from "@/lib/interview/risk";
import { allocateSurplus } from "@/lib/planning/goals";
import { buildPlan, contributionSplit } from "@/lib/invest/allocation";
import { summarisePortfolio } from "@/lib/invest/portfolio";
import { formatCurrency, formatPercent } from "@/lib/format/currency";
import { seriesColor } from "@/lib/viz/palette";
import type { AlertSeverity } from "@/lib/db/types";

export default function InvestPage() {
  const { transactions, goals, holdings, interview, loading } = useLedgrData();

  const model = useMemo(() => {
    const stats = snapshot(transactions);
    const risk = assessRisk(interview);
    const bufferMonths = emergencyFundMonths(interview);
    const portfolio = summarisePortfolio(holdings);

    // Horizon is the longest goal, falling back to what the interview said and
    // then to years-to-retirement — whichever the user actually told us.
    const goalMonths = goals.length
      ? Math.max(
          ...allocateSurplus(goals, stats.monthlySurplus).allocations.map(
            (a) => a.assessment.monthsRemaining,
          ),
        )
      : 0;
    const horizonYears = Math.max(
      1,
      goalMonths > 0
        ? Math.round(goalMonths / 12)
        : interview.investmentHorizonYears ||
            Math.max(1, interview.retirementAge - interview.age),
    );

    // The surplus already includes money going into SIPs, since investing is
    // counted as saving rather than spending.
    const investable = Math.max(0, stats.monthlySurplus);

    const plan = buildPlan({
      profile: interview,
      risk: risk.profile,
      maxEquity: risk.maxEquity,
      horizonYears,
      monthlyInvestable: investable,
      monthlyExpense: stats.medianMonthlyExpense,
      bufferMonths,
      expectedReturn: 0.12,
      currentByClass: holdings.length > 0 ? portfolio.byClass : undefined,
    });

    return { stats, risk, bufferMonths, plan, horizonYears, investable, portfolio };
  }, [transactions, goals, holdings, interview]);

  if (loading) {
    return (
      <>
        <PageHeader title="Invest" lede="Target allocation and SIPs." />
        <Skeleton className="h-80" />
      </>
    );
  }

  const { risk, plan, horizonYears, investable } = model;
  const split = contributionSplit(plan.rows, investable);
  const hasProfile = interview.answered.length > 0;

  return (
    <>
      <PageHeader
        title="Invest"
        lede={`Built from your ${RISK_LABEL[risk.profile].toLowerCase()} risk profile over a ${horizonYears}-year horizon.`}
        actions={<LinkButton href="/portfolio">Track your holdings</LinkButton>}
      />

      {!hasProfile ? (
        <div className="mb-6">
          <Callout tone="warning" title="This is running entirely on defaults">
            <p>
              You have not answered any of the profile questions, so every number below is
              an assumption rather than a plan.{" "}
              <a href="/interview" className="font-medium text-series-1 underline">
                Answer them
              </a>{" "}
              and this page becomes yours.
            </p>
          </Callout>
        </div>
      ) : null}

      {plan.prerequisites.length > 0 ? (
        <Card className="mb-6">
          <CardTitle hint="These beat any expected market return. The honest answer to 'how should I invest?' is sometimes 'not yet'.">
            Before you invest
          </CardTitle>

          <ol className="flex flex-col divide-y divide-hairline">
            {plan.prerequisites.map((item) => (
              <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.amount > 0 ? (
                    <p className="text-sm font-semibold tabular">
                      {formatCurrency(item.amount)}
                    </p>
                  ) : null}
                </div>
                <p className="mt-1">
                  <StatusMark
                    severity={item.severity as AlertSeverity}
                    label={
                      item.severity === "critical"
                        ? "Do this first"
                        : item.severity === "serious"
                          ? "Important"
                          : "Worth doing"
                    }
                  />
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.detail}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Risk profile"
          value={RISK_LABEL[risk.profile]}
          hint={`Up to ${formatPercent(risk.maxEquity, 0)} equity.`}
        />
        <StatTile
          label="Investable each month"
          value={formatCurrency(investable)}
          hint="What is left after your usual spending."
        />
        <StatTile
          label="Portfolio value"
          value={formatCurrency(plan.totalCurrent)}
          hint={
            holdings.length > 0
              ? `Across ${holdings.length} holdings.`
              : "From your profile answers."
          }
        />
        <StatTile
          label="Drift from target"
          value={formatPercent(plan.totalDrift, 0)}
          status={driftStatus(plan.totalDrift)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title="Target allocation"
          hint="Where the portfolio should sit, given your risk profile and how long the money has."
          tableRows={plan.rows}
          tableColumns={[
            { key: "label", label: "Asset class", render: (r) => r.label },
            {
              key: "target",
              label: "Target",
              align: "right",
              render: (r) => formatPercent(r.targetShare, 0),
            },
            {
              key: "current",
              label: "Now",
              align: "right",
              render: (r) => formatPercent(r.currentShare, 0),
            },
            {
              key: "amount",
              label: "Held",
              align: "right",
              render: (r) => formatCurrency(r.currentAmount),
            },
            {
              key: "drift",
              label: "Drift",
              align: "right",
              render: (r) =>
                `${r.driftShare >= 0 ? "+" : ""}${formatPercent(r.driftShare, 1)}`,
            },
          ]}
          empty="Answer the profile questions to see a target allocation."
        >
          <ul className="flex flex-col gap-4">
            {plan.rows.map((row, i) => (
              <li key={row.assetClass}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      className="inline-block h-2.5 w-2.5 rounded-[3px]"
                      style={{ background: seriesColor(i) }}
                    />
                    {row.label}
                  </span>
                  <span className="tabular">
                    {formatPercent(row.targetShare, 0)}
                    <span className="ml-2 text-xs text-ink-muted">
                      now {formatPercent(row.currentShare, 0)}
                    </span>
                  </span>
                </div>

                {/* Target as the filled bar, actual as a marker on the same
                    scale — so the gap between them is the thing you read. */}
                <div className="relative h-2 overflow-hidden rounded-full bg-wash">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${row.targetShare * 100}%`,
                      background: seriesColor(i),
                      opacity: 0.35,
                    }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5"
                    style={{
                      left: `${Math.min(100, row.currentShare * 100)}%`,
                      background: "var(--ink)",
                    }}
                    aria-hidden="true"
                  />
                </div>

                <p className="mt-1 text-xs text-ink-muted">
                  {Math.abs(row.driftShare) < 0.02
                    ? "On target."
                    : row.driftShare > 0
                      ? `${formatCurrency(Math.abs(row.driftAmount))} more than target.`
                      : `${formatCurrency(Math.abs(row.driftAmount))} short of target.`}
                </p>
              </li>
            ))}
          </ul>
        </ChartFrame>

        <Card>
          <CardTitle hint="New money goes to whatever is furthest below target. Rebalancing by buying is free; rebalancing by selling costs tax and exit loads.">
            Where your next {formatCurrency(investable)} should go
          </CardTitle>

          {split.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              There is no surplus to invest right now. The Plan page shows where it might
              come from.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline">
              {split.map((row) => (
                <li
                  key={row.assetClass}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <span className="text-sm">{row.label}</span>
                  <span className="text-sm font-semibold tabular">
                    {formatCurrency(row.amount)}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {formatPercent(row.share, 0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {plan.rows
          .filter((row) => row.targetShare > 0)
          .map((row) => (
            <Card key={row.assetClass}>
              <CardTitle
                hint={`${formatPercent(row.targetShare, 0)} of the portfolio — about ${formatCurrency(row.targetAmount)}.`}
              >
                {row.label}
              </CardTitle>

              <ul className="flex flex-col divide-y divide-hairline">
                {row.instruments.map((instrument) => (
                  <li key={instrument.instrument} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{instrument.label}</p>
                      <p className="text-xs text-ink-secondary tabular">
                        {formatPercent(instrument.weight, 0)} of {row.label.toLowerCase()}
                      </p>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {instrument.rationale}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
      </div>

      <div className="mt-6">
        <AdviceDisclaimer />
      </div>
    </>
  );
}

function driftStatus(drift: number): { severity: AlertSeverity; label: string } {
  if (drift < 0.05) return { severity: "good", label: "In balance" };
  if (drift < 0.1) return { severity: "warning", label: "Drifting" };
  if (drift < 0.2) return { severity: "serious", label: "Out of balance" };
  return { severity: "critical", label: "Far from target" };
}
