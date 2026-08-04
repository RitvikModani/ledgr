/**
 * The Ledgr mark.
 *
 * A grid of spreadsheet cells with the ascending ones filled in. The claim the
 * whole app rests on is that the plan is not something drawn on top of your
 * data — it is your data, read properly. This is that sentence as a shape: the
 * trajectory is made of the cells, not laid over them.
 *
 * Deliberately not a rising line in a rounded square. That silhouette belongs
 * to half of Indian fintech, and a mark that could be four other apps is not a
 * mark. Cell grids also survive small sizes better than strokes do — at 16px a
 * thin line turns to grey mush, while a grid keeps its rhythm.
 *
 * Four shapes' worth of detail, because the favicon renders at 16px. The
 * diagonal of saffron cells is what stays recognisable once nothing else does.
 *
 * Fixed hex rather than the CSS palette variables: the favicon and browser
 * notifications both render outside the document, where those variables do not
 * resolve. The mark is intentionally its own colour story, separate from the
 * chart palette — that one is tuned for colour-vision separation across eight
 * series and has a different job.
 */
export const MARK_INK = "#141C26";
export const MARK_SAFFRON = "#F2A03D";
export const MARK_BONE = "#F5F1E8";

/** Cells that are just the sheet. */
const QUIET_CELLS = [
  [6.6, 6.6],
  [13.2, 6.6],
  [6.6, 13.2],
  [19.8, 13.2],
  [13.2, 19.8],
  [19.8, 19.8],
] as const;

/** Cells that ascend — the plan. */
const LIVE_CELLS = [
  [6.6, 19.8],
  [13.2, 13.2],
  [19.8, 6.6],
] as const;

export function LedgrMark({
  size = 24,
  rounded = true,
  title,
}: {
  size?: number;
  /** Off for a standalone glyph with no plate behind it. */
  rounded?: boolean;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}

      {rounded ? <rect width="32" height="32" rx="7" fill={MARK_INK} /> : null}

      <g fill={MARK_BONE} fillOpacity="0.26">
        {QUIET_CELLS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5.6" height="5.6" rx="1.7" />
        ))}
      </g>

      <g fill={MARK_SAFFRON}>
        {LIVE_CELLS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5.6" height="5.6" rx="1.7" />
        ))}
      </g>
    </svg>
  );
}
