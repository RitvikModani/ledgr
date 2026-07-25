"use client";

import { useState } from "react";
import { AmountInput, ChoiceGroup, Field, Slider, TextInput } from "@/components/ui/fields";
import { Button, Callout, Card } from "@/components/ui/primitives";
import { formatCurrency, formatPercent } from "@/lib/format/currency";
import { addCalendarMonths, todayISO } from "@/lib/format/date";
import { assessGoal } from "@/lib/planning/goals";
import type { Goal, GoalKind, GoalPriority } from "@/lib/db/types";

interface KindPreset {
  value: GoalKind;
  label: string;
  years: number;
  inflation: number;
  /** Expected return, keyed to how the money would sensibly be held over that
   *  horizon: near-term goals sit in cash, long-term ones in equity. */
  expectedReturn: number;
}

const KINDS: KindPreset[] = [
  { value: "emergency-fund", label: "Emergency fund", years: 2, inflation: 0.05, expectedReturn: 0.06 },
  { value: "home", label: "Home", years: 7, inflation: 0.07, expectedReturn: 0.1 },
  { value: "retirement", label: "Retirement", years: 25, inflation: 0.06, expectedReturn: 0.12 },
  { value: "education", label: "Education", years: 10, inflation: 0.08, expectedReturn: 0.11 },
  { value: "vehicle", label: "Vehicle", years: 4, inflation: 0.05, expectedReturn: 0.08 },
  { value: "travel", label: "Travel", years: 2, inflation: 0.05, expectedReturn: 0.06 },
  { value: "debt-payoff", label: "Debt payoff", years: 3, inflation: 0, expectedReturn: 0.06 },
  { value: "custom", label: "Something else", years: 5, inflation: 0.06, expectedReturn: 0.1 },
];

export function GoalEditor({
  goal,
  onSave,
  onCancel,
}: {
  goal: Goal | null;
  onSave: (goal: Goal) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Goal>(
    goal ?? {
      name: "",
      kind: "emergency-fund",
      targetAmount: 0,
      currentAmount: 0,
      targetDate: addCalendarMonths(todayISO(), 24),
      priority: "high",
      expectedAnnualReturn: 0.06,
      inflationRate: 0.05,
      monthlyContribution: 0,
      // Stamped when the goal is actually saved, not while it is being typed:
      // reading the clock during render is impure.
      createdAt: 0,
    },
  );

  function patch(next: Partial<Goal>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  // Live so the consequence of every field is visible while typing, rather than
  // after saving and navigating back.
  const preview = draft.targetAmount > 0 ? assessGoal(draft) : null;

  return (
    <Card>
      <h2 className="mb-5 text-sm font-semibold">{goal ? "Edit goal" : "New goal"}</h2>

      <div className="grid gap-5 lg:grid-cols-2">
        <Field label="What is it for?">
          <ChoiceGroup
            name="Goal kind"
            value={draft.kind}
            options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
            onChange={(kind) => {
              const preset = KINDS.find((k) => k.value === kind)!;
              patch({
                kind,
                inflationRate: preset.inflation,
                expectedAnnualReturn: preset.expectedReturn,
                targetDate: addCalendarMonths(todayISO(), preset.years * 12),
                name: draft.name || preset.label,
              });
            }}
          />
        </Field>

        <div className="flex flex-col gap-5">
          <Field label="Name it" htmlFor="goal-name">
            <TextInput
              id="goal-name"
              value={draft.name}
              placeholder="Six months of expenses"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </Field>

          <Field
            label="How much do you need?"
            hint="In today's money. Ledgr adjusts for inflation to the target date."
          >
            <AmountInput
              value={draft.targetAmount}
              onChange={(targetAmount) => patch({ targetAmount })}
            />
          </Field>

          <Field label="How much do you already have toward it?">
            <AmountInput
              value={draft.currentAmount}
              onChange={(currentAmount) => patch({ currentAmount })}
            />
          </Field>
        </div>

        <Field label="By when?" htmlFor="goal-date">
          <TextInput
            id="goal-date"
            type="date"
            value={draft.targetDate}
            onChange={(event) => patch({ targetDate: event.target.value })}
          />
        </Field>

        <Field
          label="How much can you put in each month?"
          hint="Leave at zero and Ledgr will tell you what it would take."
        >
          <AmountInput
            value={draft.monthlyContribution}
            onChange={(monthlyContribution) => patch({ monthlyContribution })}
          />
        </Field>

        <Field
          label="Priority"
          hint="When your surplus cannot fund everything, higher priorities are funded fully first."
        >
          <ChoiceGroup
            name="Priority"
            value={draft.priority}
            options={[
              { value: "high" as GoalPriority, label: "High" },
              { value: "medium" as GoalPriority, label: "Medium" },
              { value: "low" as GoalPriority, label: "Low" },
            ]}
            onChange={(priority) => patch({ priority })}
          />
        </Field>

        <Field
          label="Expected annual return"
          htmlFor="goal-return"
          hint="What you expect the money to earn. Lower for near-term goals held in cash."
        >
          <Slider
            id="goal-return"
            min={0}
            max={0.18}
            step={0.005}
            value={draft.expectedAnnualReturn}
            onChange={(expectedAnnualReturn) => patch({ expectedAnnualReturn })}
            format={(value) => formatPercent(value, 1)}
          />
        </Field>

        <Field
          label="Assumed inflation"
          htmlFor="goal-inflation"
          hint="How much more the same thing will cost by the target date."
        >
          <Slider
            id="goal-inflation"
            min={0}
            max={0.12}
            step={0.005}
            value={draft.inflationRate}
            onChange={(inflationRate) => patch({ inflationRate })}
            format={(value) => formatPercent(value, 1)}
          />
        </Field>
      </div>

      {preview ? (
        <div className="mt-6">
          <Callout title="What this means">
            <p>
              {formatCurrency(draft.targetAmount)} today will cost about{" "}
              <strong>{formatCurrency(preview.targetAtMaturity)}</strong> by then. Reaching
              it needs about{" "}
              <strong>{formatCurrency(preview.requiredMonthly)} a month</strong> at{" "}
              {formatPercent(draft.expectedAnnualReturn, 1)}.
            </p>
            {preview.monthlyShortfall > 0 ? (
              <p>
                You have set aside {formatCurrency(draft.monthlyContribution)} a month, which
                is {formatCurrency(preview.monthlyShortfall)} short.
              </p>
            ) : null}
          </Callout>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!draft.name.trim() || draft.targetAmount <= 0}
          onClick={() =>
            onSave({
              ...draft,
              name: draft.name.trim(),
              createdAt: draft.createdAt || Date.now(),
            })
          }
        >
          {goal ? "Save changes" : "Add this goal"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
