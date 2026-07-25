"use client";

import type { ReactNode } from "react";
import { formatCurrency } from "@/lib/format/currency";

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-lg border border-hairline-strong bg-surface-raised px-3 py-2 text-sm text-ink transition-colors focus:border-series-1 focus:outline-none disabled:opacity-50";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${CONTROL} ${props.className ?? ""}`}>
      {children}
    </select>
  );
}

/**
 * A number input for money.
 *
 * Kept as a text input on purpose: `type="number"` silently rejects the grouped
 * form people actually type ("1,50,000") and hijacks the scroll wheel over the
 * field. This accepts the grouping, strips it on change, and shows the formatted
 * value underneath so the user can check they typed what they meant.
 */
export function AmountInput({
  value,
  onChange,
  id,
  placeholder,
  min = 0,
}: {
  value: number;
  onChange: (next: number) => void;
  id?: string;
  placeholder?: string;
  min?: number;
}) {
  return (
    <div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-muted">
          ₹
        </span>
        <input
          id={id}
          inputMode="decimal"
          placeholder={placeholder}
          value={value === 0 ? "" : String(value)}
          onChange={(event) => {
            const cleaned = event.target.value.replace(/[^0-9.]/g, "");
            const parsed = Number(cleaned);
            onChange(Number.isFinite(parsed) ? Math.max(min, parsed) : min);
          }}
          className={`${CONTROL} pl-7 tabular`}
        />
      </div>
      {value > 0 ? (
        <p className="mt-1 text-xs text-ink-muted">{formatCurrency(value)}</p>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--series-1)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export function ChoiceGroup<T extends string>({
  name,
  value,
  options,
  onChange,
  columns = 2,
}: {
  name: string;
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (next: T) => void;
  columns?: 1 | 2;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`grid gap-2 ${columns === 1 ? "grid-cols-1" : "sm:grid-cols-2"}`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              selected
                ? "border-series-1 bg-wash font-medium text-ink"
                : "border-hairline-strong text-ink-secondary hover:bg-wash"
            }`}
          >
            <span className="block">{option.label}</span>
            {option.hint ? (
              <span className="mt-0.5 block text-xs text-ink-muted">{option.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  id,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  id?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-wash accent-[var(--series-1)]"
      />
      <output
        htmlFor={id}
        className="w-24 shrink-0 text-right text-sm font-medium tabular"
      >
        {format ? format(value) : value}
      </output>
    </div>
  );
}
