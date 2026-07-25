import { daysBetween, todayISO, type ISODate } from "@/lib/format/date";
import type { AssetClass, Holding } from "@/lib/db/types";

export interface CashFlow {
  date: ISODate;
  /** Negative for money invested, positive for money returned or current value. */
  amount: number;
}

/**
 * Extended internal rate of return over irregular cash flows.
 *
 * XIRR rather than CAGR because contributions land on arbitrary dates: money
 * invested last month and money invested five years ago cannot share one
 * compounding period, and averaging them produces a number that flatters recent
 * investors and punishes early ones.
 *
 * Solved with Newton-Raphson and a bisection fallback. Newton alone diverges on
 * portfolios that are close to break-even, where the derivative approaches zero —
 * which is exactly the case a new investor sees, so the fallback is not an edge
 * case here.
 */
export function xirr(flows: CashFlow[], guess = 0.1): number | null {
  if (flows.length < 2) return null;

  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0].date;

  const hasOutflow = sorted.some((f) => f.amount < 0);
  const hasInflow = sorted.some((f) => f.amount > 0);
  // Without both signs there is no rate that makes the flows balance.
  if (!hasOutflow || !hasInflow) return null;

  const years = sorted.map((f) => daysBetween(start, f.date) / 365);
  const amounts = sorted.map((f) => f.amount);

  function npv(rate: number): number {
    let total = 0;
    for (let i = 0; i < amounts.length; i++) {
      total += amounts[i] / (1 + rate) ** years[i];
    }
    return total;
  }

  // Newton-Raphson.
  let rate = guess;
  for (let i = 0; i < 60; i++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) return rate;

    const h = 1e-6;
    const derivative = (npv(rate + h) - value) / h;
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;

    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  // Bisection over a wide but finite bracket.
  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  const highValue = npv(high);
  if (lowValue * highValue > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (Math.abs(midValue) < 1e-7) return mid;
    if (lowValue * midValue < 0) {
      high = mid;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }

  return (low + high) / 2;
}

export interface HoldingReturn {
  holding: Holding;
  invested: number;
  currentValue: number;
  absoluteGain: number;
  absoluteReturn: number;
  /** Annualised, null when the holding is too new or the maths does not converge. */
  annualisedReturn: number | null;
  holdingYears: number;
}

export function holdingReturn(holding: Holding, asOf: ISODate = todayISO()): HoldingReturn {
  const invested = holding.units * holding.avgCost;
  const currentValue = holding.currentValue;
  const absoluteGain = currentValue - invested;
  const holdingYears = daysBetween(holding.purchaseDate, asOf) / 365;

  // Under a couple of months, annualising amplifies noise into nonsense — a 2%
  // move over three weeks annualises to over 30%.
  const annualisedReturn =
    holdingYears >= 0.16 && invested > 0
      ? xirr([
          { date: holding.purchaseDate, amount: -invested },
          { date: asOf, amount: currentValue },
        ])
      : null;

  return {
    holding,
    invested,
    currentValue,
    absoluteGain,
    absoluteReturn: invested === 0 ? 0 : absoluteGain / invested,
    annualisedReturn,
    holdingYears,
  };
}

export interface PortfolioSummary {
  holdings: HoldingReturn[];
  invested: number;
  currentValue: number;
  absoluteGain: number;
  absoluteReturn: number;
  /** Portfolio-level XIRR over every purchase and today's total value. */
  annualisedReturn: number | null;
  byClass: Record<AssetClass, number>;
  best: HoldingReturn | null;
  worst: HoldingReturn | null;
}

export function summarisePortfolio(
  holdings: Holding[],
  asOf: ISODate = todayISO(),
): PortfolioSummary {
  const returns = holdings.map((h) => holdingReturn(h, asOf));

  const invested = returns.reduce((sum, r) => sum + r.invested, 0);
  const currentValue = returns.reduce((sum, r) => sum + r.currentValue, 0);

  const byClass: Record<AssetClass, number> = {
    equity: 0,
    debt: 0,
    gold: 0,
    cash: 0,
    "real-estate": 0,
  };
  for (const r of returns) {
    byClass[r.holding.assetClass] += r.currentValue;
  }

  // One flow per purchase plus today's total, so the portfolio rate accounts for
  // when each holding actually went in.
  const flows: CashFlow[] = returns
    .filter((r) => r.invested > 0)
    .map((r) => ({ date: r.holding.purchaseDate, amount: -r.invested }));

  if (currentValue > 0) flows.push({ date: asOf, amount: currentValue });

  const ranked = [...returns]
    .filter((r) => r.invested > 0)
    .sort((a, b) => b.absoluteReturn - a.absoluteReturn);

  return {
    holdings: returns,
    invested,
    currentValue,
    absoluteGain: currentValue - invested,
    absoluteReturn: invested === 0 ? 0 : (currentValue - invested) / invested,
    annualisedReturn: flows.length >= 2 ? xirr(flows) : null,
    byClass,
    best: ranked[0] ?? null,
    worst: ranked.at(-1) ?? null,
  };
}

export interface RebalanceAction {
  assetClass: AssetClass;
  label: string;
  action: "buy" | "sell";
  amount: number;
  driftShare: number;
}

/**
 * What it would take to get back to target.
 *
 * Only surfaced past a drift band, because rebalancing costs tax, exit loads and
 * attention. Chasing a 2% deviation is churn dressed as discipline — the
 * standard threshold is 5 percentage points on any one class, and that is what
 * this uses.
 */
export const DRIFT_THRESHOLD = 0.05;

export function rebalanceActions(
  rows: Array<{ assetClass: AssetClass; label: string; driftShare: number; driftAmount: number }>,
  threshold = DRIFT_THRESHOLD,
): RebalanceAction[] {
  return rows
    .filter((row) => Math.abs(row.driftShare) >= threshold)
    .map((row) => ({
      assetClass: row.assetClass,
      label: row.label,
      action: row.driftAmount > 0 ? ("sell" as const) : ("buy" as const),
      amount: Math.abs(row.driftAmount),
      driftShare: row.driftShare,
    }))
    .sort((a, b) => Math.abs(b.driftShare) - Math.abs(a.driftShare));
}
