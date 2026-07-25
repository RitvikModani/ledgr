"use client";

import { useState, type ReactNode } from "react";
import { ChartIcon, TableIcon } from "@/components/ui/icons";

export interface TableColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

/**
 * The wrapper every chart in Ledgr sits inside.
 *
 * It exists to make three guarantees structural rather than per-chart
 * discipline:
 *
 *   1. Every chart has a table view. That is what answers the light-mode
 *      contrast shortfall on three of the eight series colours, and it is also
 *      the only way a screen-reader user gets the numbers at all.
 *   2. Every chart has a title and a caption slot, so no chart ships as a
 *      floating rectangle of colour.
 *   3. Empty states are handled here, so no chart renders axes over no data.
 */
export function ChartFrame<T>({
  title,
  hint,
  children,
  tableRows,
  tableColumns,
  footnote,
  empty,
  actions,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  tableRows: T[];
  tableColumns: Array<TableColumn<T>>;
  footnote?: ReactNode;
  empty?: ReactNode;
  actions?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const isEmpty = tableRows.length === 0;

  return (
    <section className="rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {!isEmpty ? (
            <button
              type="button"
              onClick={() => setShowTable((value) => !value)}
              className="no-print inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-wash hover:text-ink"
              aria-pressed={showTable}
              title={showTable ? "Show chart" : "Show the numbers"}
            >
              {showTable ? <ChartIcon size={16} /> : <TableIcon size={16} />}
              <span className="sr-only">
                {showTable ? "Show chart" : "Show the numbers as a table"}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {isEmpty ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-sm text-ink-muted">
          {empty ?? "Nothing to show yet."}
        </div>
      ) : showTable ? (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-hairline bg-wash">
                {tableColumns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={`px-3 py-2 font-semibold ${
                      column.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i} className="border-b border-hairline last:border-0">
                  {tableColumns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 ${
                        column.align === "right"
                          ? "text-right tabular"
                          : "text-ink-secondary"
                      }`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot">{children}</div>
      )}

      {footnote ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">{footnote}</p>
      ) : null}
    </section>
  );
}

/**
 * Legend for two or more series.
 *
 * Always rendered when there is more than one series, so identity is never
 * carried by colour alone. A single-series chart gets none — its title already
 * names what the line is, and a one-row legend is just noise.
 */
export function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  if (items.length < 2) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-ink-secondary">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

/**
 * Shared tooltip body.
 *
 * Values stay in text ink rather than the series colour — a coloured swatch
 * beside the label already carries identity, and colouring the number too makes
 * it harder to read against the surface for exactly the low-contrast slots the
 * palette flagged.
 */
export function ChartTooltipBody({
  title,
  rows,
  note,
}: {
  title: string;
  rows: TooltipRow[];
  note?: string;
}) {
  return (
    <div className="pointer-events-none rounded-lg border border-hairline-strong bg-surface-raised px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-ink">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-secondary">
              {row.color ? (
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: row.color }}
                />
              ) : null}
              {row.label}
            </span>
            <span className="font-medium text-ink tabular">{row.value}</span>
          </li>
        ))}
      </ul>
      {note ? <p className="mt-1.5 text-ink-muted">{note}</p> : null}
    </div>
  );
}
