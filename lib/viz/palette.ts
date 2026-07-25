/**
 * Chart colour, as CSS custom-property references.
 *
 * Every value here points at a variable defined once in globals.css, so light
 * and dark are the same code path and the palette can never drift between the
 * UI chrome and the charts.
 *
 * The palette was validated with the data-viz validator against the exact
 * surfaces the app renders on (#fcfcfb light, #1a1a19 dark): lightness band,
 * chroma floor, colour-vision separation and normal-vision separation all pass
 * in both modes. Three light-mode slots fall below 3:1 contrast, which is why
 * ChartFrame always ships a table view and the charts carry direct labels.
 */

/** Categorical hues, in fixed order. Assign by index; never cycle past the end. */
export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
] as const;

export const MAX_SERIES = SERIES.length;

/**
 * Colour for a series, by its position.
 *
 * Callers must pass a *stable* index derived from the entity, not the position
 * after filtering. Colour follows the thing, not its rank — a filter that
 * changes how many series are on screen must never repaint the survivors.
 */
export function seriesColor(index: number): string {
  return SERIES[index % MAX_SERIES];
}

/**
 * Forms where every series can appear beside every other — scatter, bubble,
 * small multiples. Only the first three slots clear the all-pairs colour-vision
 * floor; past three, fold into "Other" or facet instead.
 */
export const MAX_SERIES_ALL_PAIRS = 3;

/** One hue, light to dark. For continuous magnitude only. */
export const SEQUENTIAL = [
  "var(--seq-100)",
  "var(--seq-250)",
  "var(--seq-400)",
  "var(--seq-450)",
  "var(--seq-550)",
  "var(--seq-700)",
] as const;

/**
 * Sequential step for a 0..1 magnitude.
 *
 * Starts at index 1 rather than 0: the lightest step recedes into the surface,
 * which is right for a heatmap cell meaning "near zero" but wrong for a bar the
 * user still has to see.
 */
export function sequentialColor(fraction: number, floor = 1): string {
  const usable = SEQUENTIAL.length - floor;
  const step = Math.min(usable - 1, Math.max(0, Math.round(fraction * (usable - 1))));
  return SEQUENTIAL[floor + step];
}

/** Two poles and a neutral midpoint. The midpoint is grey, never a third hue. */
export const DIVERGING = {
  negative: "var(--diverge-neg)",
  neutral: "var(--diverge-mid)",
  positive: "var(--diverge-pos)",
} as const;

/** Reserved. Never used as a series colour, never the sole carrier of meaning. */
export const STATUS = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  serious: "var(--status-serious)",
  critical: "var(--status-critical)",
} as const;

export const CHROME = {
  grid: "var(--grid)",
  axis: "var(--axis)",
  surface: "var(--surface)",
  ink: "var(--ink)",
  inkSecondary: "var(--ink-secondary)",
  inkMuted: "var(--ink-muted)",
} as const;

/** Shared Recharts axis styling, so no chart re-invents its chrome. */
export const AXIS_STYLE = {
  stroke: CHROME.axis,
  tick: { fill: CHROME.inkMuted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: CHROME.axis },
} as const;

export const GRID_STYLE = {
  stroke: CHROME.grid,
  strokeDasharray: "0",
  vertical: false,
} as const;
