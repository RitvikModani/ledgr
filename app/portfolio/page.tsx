"use client";

import { useMemo, useState } from "react";
import { StatTile, StatusMark } from "@/components/charts/StatTile";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { AmountInput, ChoiceGroup, Field, Select, TextInput } from "@/components/ui/fields";
import {
  AdviceDisclaimer,
  Button,
  Callout,
  Card,
  CardTitle,
  EmptyState,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { PlusIcon, TableIcon } from "@/components/ui/icons";
import { deleteHolding, saveHolding } from "@/lib/db/repositories";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { snapshot } from "@/lib/analytics/aggregate";
import { assessRisk, emergencyFundMonths } from "@/lib/interview/risk";
import { ASSET_LABEL, buildPlan, INSTRUMENT_LABEL } from "@/lib/invest/allocation";
import { rebalanceActions, summarisePortfolio } from "@/lib/invest/portfolio";
import { formatCurrency, formatPercent } from "@/lib/format/currency";
import { formatDate, todayISO } from "@/lib/format/date";
import { seriesColor } from "@/lib/viz/palette";
import type { AssetClass, Holding, InstrumentCategory } from "@/lib/db/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "debt", "gold", "cash", "real-estate"];

export default function PortfolioPage() {
  const { holdings, transactions, interview, loading } = useLedgrData();
  const [editing, setEditing] = useState<Holding | "new" | null>(null);

  const model = useMemo(() => {
    const summary = summarisePortfolio(holdings);
    const stats = snapshot(transactions);
    const risk = assessRisk(interview);

    const plan = buildPlan({
      profile: interview,
      risk: risk.profile,
      maxEquity: risk.maxEquity,
      horizonYears: Math.max(1, interview.investmentHorizonYears),
      monthlyInvestable: Math.max(0, stats.monthlySurplus),
      monthlyExpense: stats.medianMonthlyExpense,
      bufferMonths: emergencyFundMonths(interview),
      expectedReturn: 0.12,
      currentByClass: holdings.length > 0 ? summary.byClass : undefined,
    });

    return { summary, plan, actions: rebalanceActions(plan.rows) };
  }, [holdings, transactions, interview]);

  if (loading) {
    return (
      <>
        <PageHeader title="Portfolio" lede="Holdings, returns and drift." />
        <Skeleton className="h-80" />
      </>
    );
  }

  if (editing !== null) {
    return (
      <>
        <PageHeader title="Portfolio" lede="Holdings, returns and drift." />
        <HoldingEditor
          holding={editing === "new" ? null : editing}
          onSave={async (holding) => {
            await saveHolding(holding);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </>
    );
  }

  if (holdings.length === 0) {
    return (
      <>
        <PageHeader title="Portfolio" lede="Holdings, returns and drift." />
        <EmptyState
          icon={<TableIcon size={28} />}
          title="No holdings yet"
          body="Import a portfolio export from your broker or fund house, or add holdings by hand. Ledgr works out what you have made, annualises it properly with XIRR, and shows how far your actual mix has drifted from the target."
          action={
            <>
              <LinkButton href="/import" variant="primary">
                Import a holdings sheet
              </LinkButton>
              <Button onClick={() => setEditing("new")}>Add one by hand</Button>
            </>
          }
        />
      </>
    );
  }

  const { summary, plan, actions } = model;

  return (
    <>
      <PageHeader
        title="Portfolio"
        lede={`${holdings.length} holdings, worth ${formatCurrency(summary.currentValue)}.`}
        actions={
          <>
            <Button onClick={() => setEditing("new")}>
              <PlusIcon size={16} /> Add holding
            </Button>
            <LinkButton href="/import">Import more</LinkButton>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Invested" value={formatCurrency(summary.invested)} />
        <StatTile
          label="Current value"
          value={formatCurrency(summary.currentValue)}
          delta={
            summary.invested > 0
              ? { value: summary.absoluteReturn, label: "overall", higherIsBetter: true }
              : null
          }
        />
        <StatTile
          label="Gain"
          value={formatCurrency(summary.absoluteGain, { signed: true })}
          hint="Current value less what you put in."
        />
        <StatTile
          label="Annualised (XIRR)"
          value={
            summary.annualisedReturn === null
              ? "Too early"
              : formatPercent(summary.annualisedReturn, 1)
          }
          hint="Weighted by when each purchase actually happened, not a simple average."
        />
      </div>

      {actions.length > 0 ? (
        <div className="mb-6">
          <Callout tone="warning" title="Your mix has drifted from target">
            <p>
              {actions
                .map(
                  (action) =>
                    `${action.action === "buy" ? "Add" : "Trim"} about ${formatCurrency(action.amount)} ${action.action === "buy" ? "to" : "from"} ${action.label.toLowerCase()}`,
                )
                .join("; ")}
              .
            </p>
            <p>
              Where you can, do this by directing new contributions rather than selling —
              buying to rebalance costs nothing, selling costs capital gains tax and
              possibly an exit load. The{" "}
              <a href="/invest" className="font-medium text-series-1 underline">
                Invest page
              </a>{" "}
              already splits your monthly amount that way.
            </p>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartFrame
          title="Actual vs target mix"
          hint="Only drift beyond five percentage points is worth acting on — chasing smaller gaps is churn."
          tableRows={plan.rows}
          tableColumns={[
            { key: "label", label: "Asset class", render: (r) => r.label },
            {
              key: "value",
              label: "Value",
              align: "right",
              render: (r) => formatCurrency(r.currentAmount),
            },
            {
              key: "now",
              label: "Now",
              align: "right",
              render: (r) => formatPercent(r.currentShare, 1),
            },
            {
              key: "target",
              label: "Target",
              align: "right",
              render: (r) => formatPercent(r.targetShare, 1),
            },
            {
              key: "drift",
              label: "Drift",
              align: "right",
              render: (r) =>
                `${r.driftShare >= 0 ? "+" : ""}${formatPercent(r.driftShare, 1)}`,
            },
          ]}
          empty="Import holdings to compare against your target."
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
                  <span className="tabular">{formatCurrency(row.currentAmount)}</span>
                </div>

                {/* Actual as the filled bar, target as a marker on the same
                    scale — one axis, so the gap is what you read. */}
                <div className="relative h-2 overflow-hidden rounded-full bg-wash">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, row.currentShare * 100)}%`,
                      background: seriesColor(i),
                    }}
                  />
                  <div
                    className="absolute top-0 h-full w-0.5"
                    style={{
                      left: `${Math.min(100, row.targetShare * 100)}%`,
                      background: "var(--ink)",
                    }}
                    aria-hidden="true"
                  />
                </div>

                <p className="mt-1 text-xs text-ink-muted">
                  {formatPercent(row.currentShare, 0)} now, target{" "}
                  {formatPercent(row.targetShare, 0)}
                  {Math.abs(row.driftShare) >= 0.05 ? " — worth rebalancing" : ""}
                </p>
              </li>
            ))}
          </ul>
        </ChartFrame>

        <ChartFrame
          title="Every holding"
          hint="Annualised returns are blank for anything held under two months — annualising a few weeks produces nonsense."
          tableRows={summary.holdings}
          tableColumns={[
            { key: "name", label: "Holding", render: (r) => r.holding.name },
            { key: "class", label: "Class", render: (r) => ASSET_LABEL[r.holding.assetClass] },
            {
              key: "invested",
              label: "Invested",
              align: "right",
              render: (r) => formatCurrency(r.invested),
            },
            {
              key: "value",
              label: "Value",
              align: "right",
              render: (r) => formatCurrency(r.currentValue),
            },
            {
              key: "return",
              label: "Return",
              align: "right",
              render: (r) => formatPercent(r.absoluteReturn, 1),
            },
            {
              key: "xirr",
              label: "XIRR",
              align: "right",
              render: (r) =>
                r.annualisedReturn === null ? "—" : formatPercent(r.annualisedReturn, 1),
            },
          ]}
          empty="No holdings yet."
        >
          <ul className="flex flex-col divide-y divide-hairline">
            {summary.holdings.map((row) => (
              <li
                key={row.holding.id ?? row.holding.name}
                className="py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.holding.name}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {INSTRUMENT_LABEL[row.holding.instrument]} · since{" "}
                      {formatDate(row.holding.purchaseDate)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular">
                      {formatCurrency(row.currentValue)}
                    </p>
                    <p
                      className={`text-xs tabular ${
                        row.absoluteGain >= 0 ? "text-text-good" : "text-text-bad"
                      }`}
                    >
                      {formatCurrency(row.absoluteGain, { signed: true })} (
                      {formatPercent(row.absoluteReturn, 1)})
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => setEditing(row.holding)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => row.holding.id && deleteHolding(row.holding.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ChartFrame>
      </div>

      {summary.best && summary.worst && summary.best !== summary.worst ? (
        <Card className="mt-6">
          <CardTitle>Best and weakest</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <StatusMark severity="good" label="Best" />
              <p className="mt-1 text-sm font-medium">{summary.best.holding.name}</p>
              <p className="text-xs text-ink-muted tabular">
                {formatPercent(summary.best.absoluteReturn, 1)} overall
              </p>
            </div>
            <div>
              <StatusMark
                severity={summary.worst.absoluteReturn < 0 ? "serious" : "warning"}
                label="Weakest"
              />
              <p className="mt-1 text-sm font-medium">{summary.worst.holding.name}</p>
              <p className="text-xs text-ink-muted tabular">
                {formatPercent(summary.worst.absoluteReturn, 1)} overall
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mt-6">
        <AdviceDisclaimer />
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function HoldingEditor({
  holding,
  onSave,
  onCancel,
}: {
  holding: Holding | null;
  onSave: (holding: Holding) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Holding>(
    holding ?? {
      name: "",
      assetClass: "equity",
      instrument: "index-fund",
      units: 1,
      avgCost: 0,
      currentValue: 0,
      purchaseDate: todayISO(),
      // saveHolding stamps this; reading the clock during render is impure.
      updatedAt: 0,
    },
  );

  function patch(next: Partial<Holding>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  const invested = draft.units * draft.avgCost;

  return (
    <Card>
      <h2 className="mb-5 text-sm font-semibold">
        {holding ? "Edit holding" : "Add a holding"}
      </h2>

      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="Name" htmlFor="holding-name">
          <TextInput
            id="holding-name"
            value={draft.name}
            placeholder="UTI Nifty 50 Index Fund"
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>

        <Field label="Asset class">
          <ChoiceGroup
            name="Asset class"
            value={draft.assetClass}
            options={ASSET_CLASSES.map((value) => ({ value, label: ASSET_LABEL[value] }))}
            onChange={(assetClass) => patch({ assetClass })}
          />
        </Field>

        <Field label="Instrument" htmlFor="holding-instrument">
          <Select
            id="holding-instrument"
            value={draft.instrument}
            onChange={(event) =>
              patch({ instrument: event.target.value as InstrumentCategory })
            }
          >
            {(Object.keys(INSTRUMENT_LABEL) as InstrumentCategory[]).map((value) => (
              <option key={value} value={value}>
                {INSTRUMENT_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Bought on"
          htmlFor="holding-date"
          hint="Used to annualise the return. A rough guess beats today's date, which would make the return look like it happened overnight."
        >
          <TextInput
            id="holding-date"
            type="date"
            value={draft.purchaseDate}
            onChange={(event) => patch({ purchaseDate: event.target.value })}
          />
        </Field>

        <Field
          label="What you put in"
          hint={invested > 0 ? `Recorded as ${formatCurrency(invested)} invested.` : undefined}
        >
          <AmountInput
            value={draft.avgCost * draft.units}
            onChange={(total) => patch({ units: 1, avgCost: total })}
          />
        </Field>

        <Field label="What it is worth now">
          <AmountInput
            value={draft.currentValue}
            onChange={(currentValue) => patch({ currentValue })}
          />
        </Field>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!draft.name.trim() || draft.currentValue <= 0}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
        >
          {holding ? "Save changes" : "Add holding"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
