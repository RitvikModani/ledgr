export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP";

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

const LOCALE_BY_CURRENCY: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "en-IE",
  GBP: "en-GB",
};

export const CURRENCY_SYMBOL: Record<CurrencyCode, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

export interface CurrencyOptions {
  currency?: CurrencyCode;
  /** Show paise / cents. Off by default — plans are not budgeted to the paisa. */
  decimals?: boolean;
  /** Force a leading + on positive values. Useful for deltas. */
  signed?: boolean;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = build();
    formatterCache.set(key, cached);
  }
  return cached;
}

/**
 * Full currency, grouped the way the locale groups.
 *
 * en-IN groups by the Indian system, so 1500000 reads ₹15,00,000 — not
 * ₹1,500,000. That difference is the whole reason this goes through Intl rather
 * than a hand-rolled regex.
 */
export function formatCurrency(value: number, options: CurrencyOptions = {}): string {
  const { currency = DEFAULT_CURRENCY, decimals = false, signed = false } = options;
  if (!Number.isFinite(value)) return "—";

  const key = `c:${currency}:${decimals}`;
  const nf = formatter(key, () =>
    new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
      style: "currency",
      currency,
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    }),
  );

  const formatted = nf.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}

interface CompactUnit {
  threshold: number;
  divisor: number;
  suffix: string;
}

/** Indian units. Crore before lakh so the larger one matches first. */
const INDIAN_UNITS: CompactUnit[] = [
  { threshold: 1e7, divisor: 1e7, suffix: "Cr" },
  { threshold: 1e5, divisor: 1e5, suffix: "L" },
  { threshold: 1e3, divisor: 1e3, suffix: "K" },
];

const WESTERN_UNITS: CompactUnit[] = [
  { threshold: 1e9, divisor: 1e9, suffix: "B" },
  { threshold: 1e6, divisor: 1e6, suffix: "M" },
  { threshold: 1e3, divisor: 1e3, suffix: "K" },
];

/**
 * Short form for axis ticks, stat tiles, and anywhere the full number would
 * crowd out its neighbours: ₹15,00,000 becomes ₹15L.
 *
 * Precision shrinks as the number grows so the string stays roughly the same
 * width — 1.25Cr, 12.5L, 125K.
 */
export function formatCompactCurrency(value: number, options: CurrencyOptions = {}): string {
  const { currency = DEFAULT_CURRENCY, signed = false } = options;
  if (!Number.isFinite(value)) return "—";

  const symbol = CURRENCY_SYMBOL[currency];
  const units = currency === "INR" ? INDIAN_UNITS : WESTERN_UNITS;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";

  const unit = units.find((u) => abs >= u.threshold);
  if (!unit) {
    return `${sign}${symbol}${Math.round(abs)}`;
  }

  const scaled = abs / unit.divisor;
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const trimmed = Number(scaled.toFixed(decimals));
  return `${sign}${symbol}${trimmed}${unit.suffix}`;
}

/** Plain grouped number, no currency symbol — for table cells under a ₹ header. */
export function formatNumber(value: number, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  if (!Number.isFinite(value)) return "—";
  const nf = formatter(`n:${currency}`, () =>
    new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], { maximumFractionDigits: 0 }),
  );
  return nf.format(value);
}

/**
 * Percentage from a fraction.
 *
 * Goes through Intl rather than `(x * 100).toFixed(d)` because that multiply
 * introduces binary float error before rounding — 0.2345 becomes 23.4499… and
 * truncates to 23.4%. Intl rounds the decimal value itself and gets 23.5%.
 */
export function formatPercent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const nf = formatter(`p:${decimals}`, () =>
    new Intl.NumberFormat("en-IN", {
      style: "percent",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }),
  );
  return nf.format(fraction);
}

/**
 * Percentage change from `previous` to `current`.
 *
 * Returns null when there is no meaningful baseline. A change "from zero" is
 * infinite, and printing ∞% or 100% in a stat tile misleads — callers render
 * "new" or hide the delta instead.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
