"use client";

import { cellToText } from "@/lib/import/coerce";
import type {
  ColumnMapping,
  ColumnProfile,
  FieldRole,
  FieldSpec,
  RawRow,
} from "@/lib/import/detect";
import { Field, Select } from "@/components/ui/fields";
import { Callout } from "@/components/ui/primitives";

const PREVIEW_ROWS = 5;

function confidenceLabel(value: number | undefined): {
  text: string;
  tone: "good" | "warning" | "muted";
} {
  if (value === undefined) return { text: "Not detected", tone: "warning" };
  if (value >= 0.75) return { text: "Confident", tone: "good" };
  if (value >= 0.45) return { text: "Likely", tone: "warning" };
  return { text: "Best guess", tone: "warning" };
}

export function ColumnMapper({
  fields,
  columns,
  mapping,
  confidence,
  rows,
  headerRow,
  onChange,
  problems,
}: {
  fields: FieldSpec[];
  columns: ColumnProfile[];
  mapping: ColumnMapping;
  confidence: Partial<Record<FieldRole, number>>;
  rows: RawRow[];
  headerRow: number;
  onChange: (next: ColumnMapping) => void;
  problems: string[];
}) {
  const preview = rows.slice(headerRow + 1, headerRow + 1 + PREVIEW_ROWS);

  function setRole(role: FieldRole, index: number | undefined) {
    const next: ColumnMapping = { ...mapping };

    if (index === undefined) {
      delete next[role];
    } else {
      // One column, one role. Taking a column from another role is almost always
      // what the user means, and silently allowing a double-assignment produces
      // transactions whose amount and balance are the same number.
      for (const key of Object.keys(next) as FieldRole[]) {
        if (next[key] === index) delete next[key];
      }
      next[role] = index;
    }

    onChange(next);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div>
        <h2 className="text-sm font-semibold">Check the columns</h2>
        <p className="mb-4 mt-1 text-xs leading-relaxed text-ink-secondary">
          Ledgr guessed these from your headers and the data underneath. Fix anything it
          got wrong before importing.
        </p>

        {problems.length > 0 ? (
          <div className="mb-4">
            <Callout tone="warning" title="Still needed">
              <ul className="mt-1 list-disc pl-4">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Callout>
          </div>
        ) : null}

        <div className="flex flex-col gap-4">
          {fields.map((spec) => {
            const badge = confidenceLabel(confidence[spec.role]);
            const selected = mapping[spec.role];

            return (
              <Field
                key={spec.role}
                htmlFor={`map-${spec.role}`}
                label={spec.required ? `${spec.label} *` : spec.label}
                hint={spec.help}
              >
                <div className="flex items-center gap-2">
                  <Select
                    id={`map-${spec.role}`}
                    value={selected === undefined ? "" : String(selected)}
                    onChange={(event) =>
                      setRole(
                        spec.role,
                        event.target.value === "" ? undefined : Number(event.target.value),
                      )
                    }
                  >
                    <option value="">— not in this sheet —</option>
                    {columns.map((column) => (
                      <option key={column.index} value={column.index}>
                        {column.header}
                      </option>
                    ))}
                  </Select>
                  {selected !== undefined ? (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        badge.tone === "good"
                          ? "text-text-good"
                          : badge.tone === "warning"
                            ? "text-ink-secondary"
                            : "text-ink-muted"
                      }`}
                    >
                      {badge.text}
                    </span>
                  ) : null}
                </div>
              </Field>
            );
          })}
        </div>
      </div>

      <div className="min-w-0">
        <h2 className="text-sm font-semibold">Your sheet</h2>
        <p className="mb-4 mt-1 text-xs text-ink-secondary">
          Row {headerRow + 1} was read as the header. Mapped columns are marked.
        </p>

        <div className="overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-hairline bg-wash">
                {columns.map((column) => {
                  const role = (Object.keys(mapping) as FieldRole[]).find(
                    (key) => mapping[key] === column.index,
                  );
                  const spec = fields.find((f) => f.role === role);
                  return (
                    <th key={column.index} className="px-3 py-2 font-semibold">
                      <span className="block">{column.header}</span>
                      <span
                        className={`mt-0.5 block text-[11px] font-normal ${
                          spec ? "text-series-1" : "text-ink-muted"
                        }`}
                      >
                        {spec ? `→ ${spec.label}` : "unused"}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-hairline last:border-0">
                  {columns.map((column) => (
                    <td
                      key={column.index}
                      className="max-w-[16rem] truncate px-3 py-2 text-ink-secondary tabular"
                    >
                      {cellToText(row[column.index])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
