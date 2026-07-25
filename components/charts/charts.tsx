"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame, ChartLegend, ChartTooltipBody } from "./ChartFrame";
import {
  AXIS_STYLE,
  DIVERGING,
  GRID_STYLE,
  sequentialColor,
  seriesColor,
} from "@/lib/viz/palette";
import { formatCompactCurrency, formatCurrency } from "@/lib/format/currency";
import { formatDate, formatMonthKey } from "@/lib/format/date";
import type { CategoryTotal, MonthlyTotals } from "@/lib/analytics/aggregate";
import type { BalancePoint, CategoryTrendPoint } from "@/lib/analytics/aggregate";

const CHART_HEIGHT = 260;

/* -------------------------------------------------------------------------- */
/* Income vs expense over time                                                */
/* -------------------------------------------------------------------------- */

/**
 * Two series, one y-axis.
 *
 * Income and expense are the same unit and comparable magnitudes, so they share
 * a scale. Putting expense on a second axis would let the two lines cross
 * wherever the scales happened to make them cross, which is the single most
 * misleading thing a chart can do.
 */
export function CashflowChart({ months }: { months: MonthlyTotals[] }) {
  const legend = [
    { label: "Income", color: seriesColor(0) },
    { label: "Spending", color: seriesColor(1) },
  ];

  return (
    <ChartFrame
      title="Income and spending"
      hint="Per month. Transfers between your own accounts are excluded."
      tableRows={months}
      tableColumns={[
        { key: "month", label: "Month", render: (r) => formatMonthKey(r.month) },
        {
          key: "income",
          label: "Income",
          align: "right",
          render: (r) => formatCurrency(r.income),
        },
        {
          key: "expense",
          label: "Spending",
          align: "right",
          render: (r) => formatCurrency(r.expense),
        },
        {
          key: "invested",
          label: "Invested",
          align: "right",
          render: (r) => formatCurrency(r.invested),
        },
        {
          key: "net",
          label: "Left over",
          align: "right",
          render: (r) => formatCurrency(r.net, { signed: true }),
        },
      ]}
      empty="Import a statement to see your cash flow."
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="month"
            {...AXIS_STYLE}
            tickFormatter={(value: string) => formatMonthKey(value, true)}
          />
          <YAxis
            {...AXIS_STYLE}
            width={58}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={formatMonthKey(String(label))}
                  rows={payload.map((entry, i) => ({
                    label: i === 0 ? "Income" : "Spending",
                    value: formatCurrency(Number(entry.value)),
                    color: seriesColor(i),
                  }))}
                />
              ) : null
            }
          />
          <Line
            type="monotone"
            dataKey="income"
            stroke={seriesColor(0)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
          <Line
            type="monotone"
            dataKey="expense"
            stroke={seriesColor(1)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
          />
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend items={legend} />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Spending by category                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ranked magnitude, so: sorted bars in a single hue.
 *
 * Categories here are not identities being compared across charts — they are
 * quantities being ranked. Giving each one its own categorical hue would spend
 * the whole palette on a chart where colour carries no information the length
 * does not already carry.
 */
export function CategoryChart({ totals }: { totals: CategoryTotal[] }) {
  const top = totals.slice(0, 10);
  const max = top[0]?.amount ?? 1;

  return (
    <ChartFrame
      title="Where the money goes"
      hint="Biggest categories first, over the period shown."
      tableRows={totals}
      tableColumns={[
        { key: "category", label: "Category", render: (r) => r.category },
        {
          key: "amount",
          label: "Total",
          align: "right",
          render: (r) => formatCurrency(r.amount),
        },
        {
          key: "share",
          label: "Share",
          align: "right",
          render: (r) => `${(r.share * 100).toFixed(1)}%`,
        },
        { key: "count", label: "Transactions", align: "right", render: (r) => r.count },
      ]}
      empty="Import a statement to see your spending."
      footnote={
        totals.length > 10
          ? `Showing the top 10 of ${totals.length} categories. Open the table for all of them.`
          : undefined
      }
    >
      <ResponsiveContainer width="100%" height={Math.max(CHART_HEIGHT, top.length * 34)}>
        <BarChart
          data={top}
          layout="vertical"
          margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
        >
          <CartesianGrid {...GRID_STYLE} horizontal={false} vertical />
          <XAxis
            type="number"
            {...AXIS_STYLE}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <YAxis
            type="category"
            dataKey="category"
            {...AXIS_STYLE}
            width={110}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: "var(--wash)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={String(payload[0].payload.category)}
                  rows={[
                    {
                      label: "Total",
                      value: formatCurrency(Number(payload[0].value)),
                    },
                    {
                      label: "Share of spending",
                      value: `${(payload[0].payload.share * 100).toFixed(1)}%`,
                    },
                    { label: "Transactions", value: String(payload[0].payload.count) },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={18} label={endLabel}>
            {top.map((row) => (
              <Cell key={row.category} fill={sequentialColor(row.amount / max)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Direct value labels at the bar ends — the relief the light palette requires. */
// Typed against `unknown` rather than Recharts' internal label Props: that type
// admits booleans and arrays for `value`, and restating it here would break on
// every Recharts minor. Everything is coerced below anyway.
function endLabel(props: {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  value?: unknown;
}) {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const raw = Array.isArray(props.value) ? props.value[0] : props.value;

  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      dominantBaseline="middle"
      fontSize={11}
      fill="var(--ink-secondary)"
    >
      {formatCompactCurrency(Number(raw ?? 0))}
    </text>
  );
}

/* -------------------------------------------------------------------------- */
/* Category trend                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Stacked areas, capped at eight series.
 *
 * Here colour *is* identity — each band is a category tracked across months —
 * so this is the chart that spends the categorical palette, assigned in fixed
 * order. The 2px surface-coloured stroke between bands is the separator that
 * keeps adjacent hues legible for colour-vision-deficient readers.
 */
export function CategoryTrendChart({
  points,
  categories,
}: {
  points: CategoryTrendPoint[];
  categories: string[];
}) {
  const legend = categories.map((category, i) => ({
    label: category,
    color: seriesColor(i),
  }));

  return (
    <ChartFrame
      title="How spending shifts"
      hint="Each band is a category. The top eight are shown; the rest are grouped."
      tableRows={points}
      tableColumns={[
        {
          key: "month",
          label: "Month",
          render: (r) => formatMonthKey(String(r.month)),
        },
        ...categories.map((category) => ({
          key: category,
          label: category,
          align: "right" as const,
          render: (r: CategoryTrendPoint) => formatCurrency(Number(r[category] ?? 0)),
        })),
      ]}
      empty="A few months of data will show how your spending shifts."
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="month"
            {...AXIS_STYLE}
            tickFormatter={(value: string) => formatMonthKey(value, true)}
          />
          <YAxis
            {...AXIS_STYLE}
            width={58}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={formatMonthKey(String(label))}
                  rows={[...payload]
                    .reverse()
                    .filter((entry) => Number(entry.value) > 0)
                    .map((entry) => ({
                      label: String(entry.dataKey),
                      value: formatCurrency(Number(entry.value)),
                      color: seriesColor(categories.indexOf(String(entry.dataKey))),
                    }))}
                />
              ) : null
            }
          />
          {categories.map((category, i) => (
            <Area
              key={category}
              type="monotone"
              dataKey={category}
              stackId="spend"
              stroke="var(--surface)"
              strokeWidth={2}
              fill={seriesColor(i)}
              fillOpacity={1}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <ChartLegend items={legend} />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Running balance                                                            */
/* -------------------------------------------------------------------------- */

/** One series, so no legend — the title already says what the line is. */
export function BalanceChart({
  points,
  fromStatement,
}: {
  points: BalancePoint[];
  fromStatement: boolean;
}) {
  return (
    <ChartFrame
      title="Balance over time"
      hint={
        fromStatement
          ? "Closing balance from your statement."
          : "Running total of the transactions imported."
      }
      tableRows={points}
      tableColumns={[
        { key: "date", label: "Date", render: (r) => formatDate(r.date) },
        {
          key: "balance",
          label: "Balance",
          align: "right",
          render: (r) => formatCurrency(r.balance),
        },
      ]}
      empty="Import a statement to see your balance."
      footnote={
        fromStatement
          ? undefined
          : "Your sheet had no balance column, so this shows the shape of the change rather than your real balance."
      }
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="balance-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(0)} stopOpacity={0.18} />
              <stop offset="100%" stopColor={seriesColor(0)} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="date"
            {...AXIS_STYLE}
            minTickGap={40}
            tickFormatter={(value: string) => formatMonthKey(value.slice(0, 7), true)}
          />
          <YAxis
            {...AXIS_STYLE}
            width={58}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={formatDate(String(label))}
                  rows={[
                    { label: "Balance", value: formatCurrency(Number(payload[0].value)) },
                  ]}
                />
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={seriesColor(0)}
            strokeWidth={2}
            fill="url(#balance-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Budget vs actual                                                           */
/* -------------------------------------------------------------------------- */

export interface BudgetVariance {
  category: string;
  budget: number;
  actual: number;
  /** Positive means under budget, negative means over. */
  variance: number;
}

/**
 * Polarity, so: diverging bars around a zero line.
 *
 * Under and over budget are opposite states, which is exactly the job diverging
 * colour does. The midpoint is the neutral grey zero line rather than a third
 * hue, so "on budget" reads as nothing rather than as a category of its own.
 */
export function BudgetVarianceChart({ rows }: { rows: BudgetVariance[] }) {
  return (
    <ChartFrame
      title="Budget vs actual"
      hint="Bars to the right are under budget; to the left, over."
      tableRows={rows}
      tableColumns={[
        { key: "category", label: "Category", render: (r) => r.category },
        {
          key: "budget",
          label: "Budget",
          align: "right",
          render: (r) => formatCurrency(r.budget),
        },
        {
          key: "actual",
          label: "Spent",
          align: "right",
          render: (r) => formatCurrency(r.actual),
        },
        {
          key: "variance",
          label: "Difference",
          align: "right",
          render: (r) =>
            `${formatCurrency(Math.abs(r.variance))} ${r.variance >= 0 ? "under" : "over"}`,
        },
      ]}
      empty="Set some budgets on the Plan page to compare against."
    >
      <ResponsiveContainer width="100%" height={Math.max(CHART_HEIGHT, rows.length * 34)}>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid {...GRID_STYLE} horizontal={false} vertical />
          <XAxis
            type="number"
            {...AXIS_STYLE}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          <YAxis
            type="category"
            dataKey="category"
            {...AXIS_STYLE}
            width={110}
            interval={0}
          />
          <ReferenceLine x={0} stroke="var(--axis)" strokeWidth={1} />
          <Tooltip
            cursor={{ fill: "var(--wash)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={String(payload[0].payload.category)}
                  rows={[
                    {
                      label: "Budget",
                      value: formatCurrency(payload[0].payload.budget),
                    },
                    { label: "Spent", value: formatCurrency(payload[0].payload.actual) },
                    {
                      label: payload[0].payload.variance >= 0 ? "Under by" : "Over by",
                      value: formatCurrency(Math.abs(payload[0].payload.variance)),
                    },
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="variance" radius={4} barSize={18}>
            {rows.map((row) => (
              <Cell
                key={row.category}
                fill={row.variance >= 0 ? DIVERGING.positive : DIVERGING.negative}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Projections                                                                */
/* -------------------------------------------------------------------------- */

export interface ProjectionSeries {
  key: string;
  label: string;
}

export interface ProjectionPoint {
  month: string;
  [series: string]: number | string;
}

/**
 * Baseline against alternatives, capped at three series.
 *
 * Three is not arbitrary: only the first three palette slots clear the
 * colour-vision floor when every series can sit beside every other, which is the
 * case for overlapping projection lines.
 */
export function ProjectionChart({
  points,
  series,
  target,
  title,
  hint,
}: {
  points: ProjectionPoint[];
  series: ProjectionSeries[];
  target?: number;
  title: string;
  hint?: string;
}) {
  const legend = series.map((s, i) => ({ label: s.label, color: seriesColor(i) }));

  return (
    <ChartFrame
      title={title}
      hint={hint}
      tableRows={points}
      tableColumns={[
        { key: "month", label: "Month", render: (r) => formatMonthKey(String(r.month)) },
        ...series.map((s) => ({
          key: s.key,
          label: s.label,
          align: "right" as const,
          render: (r: ProjectionPoint) => formatCurrency(Number(r[s.key] ?? 0)),
        })),
      ]}
      empty="Add a goal to see how it projects."
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis
            dataKey="month"
            {...AXIS_STYLE}
            minTickGap={30}
            tickFormatter={(value: string) => formatMonthKey(value, true)}
          />
          <YAxis
            {...AXIS_STYLE}
            width={58}
            tickFormatter={(value: number) => formatCompactCurrency(value)}
          />
          {target ? (
            <ReferenceLine
              y={target}
              stroke="var(--axis)"
              strokeDasharray="4 4"
              label={{
                value: `Target ${formatCompactCurrency(target)}`,
                position: "insideTopRight",
                fill: "var(--ink-muted)",
                fontSize: 11,
              }}
            />
          ) : null}
          <Tooltip
            cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTooltipBody
                  title={formatMonthKey(String(label))}
                  rows={payload.map((entry) => {
                    const index = series.findIndex((s) => s.key === entry.dataKey);
                    return {
                      label: series[index]?.label ?? String(entry.dataKey),
                      value: formatCurrency(Number(entry.value)),
                      color: seriesColor(index),
                    };
                  })}
                />
              ) : null
            }
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={seriesColor(i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <ChartLegend items={legend} />
    </ChartFrame>
  );
}
