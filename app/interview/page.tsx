"use client";

import { useState } from "react";
import { AmountInput, ChoiceGroup, Field, Slider, TextInput } from "@/components/ui/fields";
import {
  Button,
  Callout,
  Card,
  LinkButton,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";
import { StatusMark } from "@/components/charts/StatTile";
import { answerInterview, saveInterview } from "@/lib/db/db";
import { useLedgrData } from "@/lib/hooks/useLedgrData";
import { INTERVIEW_STEPS, TOTAL_QUESTIONS, type Question } from "@/lib/interview/questions";
import {
  assessRisk,
  emergencyFundMonths,
  recommendedHealthCover,
  recommendedTermCover,
  RISK_DESCRIPTION,
  RISK_LABEL,
} from "@/lib/interview/risk";
import { formatCurrency, formatPercent } from "@/lib/format/currency";
import type { AlertSeverity, InterviewProfile, RiskProfile } from "@/lib/db/types";

export default function InterviewPage() {
  const { interview, loading } = useLedgrData();
  const [step, setStep] = useState<number | null>(null);

  if (loading) {
    return (
      <>
        <PageHeader title="Your profile" lede="The fact-find your plan is built from." />
        <Skeleton className="h-96" />
      </>
    );
  }

  // Resume where they stopped, unless they have navigated deliberately.
  const activeStep = step ?? (interview.completedAt ? -1 : interview.lastStep);

  if (activeStep === -1) {
    return <Review interview={interview} onEdit={(index) => setStep(index)} />;
  }

  return (
    <StepForm
      interview={interview}
      stepIndex={Math.min(activeStep, INTERVIEW_STEPS.length - 1)}
      onNavigate={setStep}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* The wizard                                                                 */
/* -------------------------------------------------------------------------- */

function StepForm({
  interview,
  stepIndex,
  onNavigate,
}: {
  interview: InterviewProfile;
  stepIndex: number;
  onNavigate: (step: number | null) => void;
}) {
  const step = INTERVIEW_STEPS[stepIndex];
  const isLast = stepIndex === INTERVIEW_STEPS.length - 1;
  const answeredCount = interview.answered.length;

  async function next() {
    if (isLast) {
      await saveInterview({ lastStep: stepIndex, completedAt: Date.now() });
      onNavigate(-1);
    } else {
      await saveInterview({ lastStep: stepIndex + 1 });
      onNavigate(stepIndex + 1);
    }
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <PageHeader
        title="Your profile"
        lede="Everything Ledgr recommends is built from these answers. Skip anything you would rather not say — the plan will use a sensible default and tell you which numbers it assumed."
      />

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-ink-secondary">
          <span>
            Step {stepIndex + 1} of {INTERVIEW_STEPS.length} · {step.title}
          </span>
          <span className="tabular">
            {answeredCount} of {TOTAL_QUESTIONS} answered
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-wash"
          role="progressbar"
          aria-valuenow={answeredCount}
          aria-valuemin={0}
          aria-valuemax={TOTAL_QUESTIONS}
          aria-label="Interview progress"
        >
          <div
            className="h-full rounded-full bg-series-1 transition-all"
            style={{ width: `${(answeredCount / TOTAL_QUESTIONS) * 100}%` }}
          />
        </div>
      </div>

      <Card>
        <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
        <p className="mb-6 mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-secondary">
          {step.lede}
        </p>

        <div className="flex flex-col gap-7">
          {step.questions.map((question) => (
            <QuestionField
              key={String(question.key)}
              question={question}
              interview={interview}
            />
          ))}
        </div>
      </Card>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {stepIndex > 0 ? (
          <Button onClick={() => onNavigate(stepIndex - 1)}>Back</Button>
        ) : null}
        <Button variant="primary" onClick={next}>
          {isLast ? "See what this means" : "Next"}
        </Button>
        {!isLast ? (
          <Button variant="ghost" onClick={next}>
            Skip this step
          </Button>
        ) : null}
        {interview.completedAt ? (
          <Button variant="ghost" onClick={() => onNavigate(-1)}>
            Back to summary
          </Button>
        ) : null}
      </div>
    </>
  );
}

function QuestionField({
  question,
  interview,
}: {
  question: Question;
  interview: InterviewProfile;
}) {
  const key = String(question.key);
  const answered = interview.answered.includes(key);
  const id = `q-${key}`;

  // Written straight through to IndexedDB on change. A 25-question form that
  // loses everything on a refresh is a 25-question form nobody finishes.
  function set(value: unknown) {
    void answerInterview(question.key, value as never);
  }

  const raw = interview[question.key];

  return (
    <div>
      <Field
        label={question.label}
        htmlFor={id}
        hint={
          <>
            {question.help ? <span className="block">{question.help}</span> : null}
            <span className="mt-1 flex items-start gap-1.5">
              <span className="mt-px shrink-0">
                <InfoIcon size={12} />
              </span>
              {question.why}
            </span>
          </>
        }
      >
        {question.kind === "currency" ? (
          <AmountInput
            id={id}
            value={Number(raw ?? 0)}
            placeholder={question.placeholder}
            onChange={set}
          />
        ) : null}

        {question.kind === "number" ? (
          <div className="flex items-center gap-2">
            <TextInput
              id={id}
              inputMode="numeric"
              value={String(raw ?? "")}
              onChange={(event) => {
                const parsed = Number(event.target.value.replace(/[^0-9]/g, ""));
                if (Number.isFinite(parsed)) {
                  set(Math.min(question.max, Math.max(question.min, parsed)));
                }
              }}
              className="max-w-32"
            />
            {question.suffix ? (
              <span className="text-sm text-ink-muted">{question.suffix}</span>
            ) : null}
          </div>
        ) : null}

        {question.kind === "percent" ? (
          <Slider
            id={id}
            min={question.min}
            max={question.max}
            step={question.step}
            value={Number(raw ?? 0)}
            onChange={set}
            format={(value) => formatPercent(value, 1)}
          />
        ) : null}

        {question.kind === "choice" ? (
          <ChoiceGroup
            name={question.label}
            columns={question.columns}
            value={String(raw ?? "")}
            options={question.options.map((option) => ({
              value: String(option.value),
              label: option.label,
              hint: option.hint,
            }))}
            onChange={(value) => {
              const match = question.options.find((o) => String(o.value) === value);
              set(match ? match.value : value);
            }}
          />
        ) : null}

        {question.kind === "boolean" ? (
          <ChoiceGroup
            name={question.label}
            value={raw ? "yes" : "no"}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={(value) => set(value === "yes")}
          />
        ) : null}
      </Field>

      {answered ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-text-good">
          <CheckIcon size={12} /> Saved
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-ink-muted">
          Not answered — the plan will assume this.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Review                                                                     */
/* -------------------------------------------------------------------------- */

function Review({
  interview,
  onEdit,
}: {
  interview: InterviewProfile;
  onEdit: (step: number) => void;
}) {
  const risk = assessRisk(interview);
  const bufferMonths = emergencyFundMonths(interview);
  const termCover = recommendedTermCover(interview);
  const healthCover = recommendedHealthCover(interview);
  const unanswered = TOTAL_QUESTIONS - interview.answered.length;

  async function override(next: RiskProfile | null) {
    await saveInterview({ riskProfileOverride: next });
  }

  return (
    <>
      <PageHeader
        title="Your profile"
        lede="What Ledgr took from your answers. Everything here feeds the plan, and you can change any of it."
        actions={
          <>
            <Button onClick={() => onEdit(0)}>Review answers</Button>
            <LinkButton href="/invest" variant="primary">
              See your investment plan
            </LinkButton>
          </>
        }
      />

      {unanswered > 0 ? (
        <div className="mb-6">
          <Callout title={`${unanswered} questions still unanswered`}>
            <p>
              The plan works without them, but it is running on defaults where your answers
              would be better.{" "}
              <button
                type="button"
                onClick={() => onEdit(0)}
                className="font-medium text-series-1 underline"
              >
                Fill in the gaps
              </button>
              .
            </p>
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold">Risk profile</h2>

          <p className="mt-3 text-2xl font-semibold tracking-tight">
            {RISK_LABEL[risk.profile]}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            {RISK_DESCRIPTION[risk.profile]}
          </p>

          <div className="mt-4 flex items-center gap-3 text-xs text-ink-secondary">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-wash">
              <div
                className="h-full rounded-full bg-series-1"
                style={{ width: `${risk.score}%` }}
              />
            </div>
            <span className="tabular">{risk.score}/100</span>
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Up to {formatPercent(risk.maxEquity, 0)} of the portfolio in equity.
          </p>

          {risk.caps.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium">
                Your answers scored {RISK_LABEL[risk.scoredProfile]}, but this was capped:
              </p>
              <ul className="flex flex-col gap-2">
                {risk.caps.map((cap) => (
                  <li
                    key={cap}
                    className="flex items-start gap-2 text-xs leading-relaxed text-ink-secondary"
                  >
                    <span className="mt-0.5 shrink-0 text-warning">
                      <InfoIcon size={12} />
                    </span>
                    {cap}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 border-t border-hairline pt-4">
            <p className="mb-2 text-xs font-medium">Disagree?</p>
            <div className="flex flex-wrap gap-2">
              {(["conservative", "moderate", "aggressive"] as RiskProfile[]).map((level) => (
                <Button
                  key={level}
                  onClick={() => override(level)}
                  className={
                    risk.overridden && interview.riskProfileOverride === level
                      ? "border-series-1"
                      : ""
                  }
                >
                  {RISK_LABEL[level]}
                </Button>
              ))}
              {risk.overridden ? (
                <Button variant="ghost" onClick={() => override(null)}>
                  Use Ledgr&apos;s assessment
                </Button>
              ) : null}
            </div>
            {risk.overridden ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
                You have overridden the assessment. The plan will use {RISK_LABEL[risk.profile]} —
                including where that conflicts with your horizon, which is what the cap
                existed to protect.
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold">What your answers imply</h2>

          <dl className="flex flex-col divide-y divide-hairline">
            <Implication
              term="Emergency fund"
              detail={`${bufferMonths} months of expenses`}
              why={
                interview.incomeStability === "irregular"
                  ? "Deeper than the usual six, because irregular income takes longer to replace."
                  : "Enough to replace your income while you find the next one."
              }
            />
            <Implication
              term="Health cover"
              detail={formatCurrency(healthCover)}
              why={
                interview.hasHealthInsurance
                  ? interview.healthCoverAmount >= healthCover
                    ? "Your existing cover meets this."
                    : `You hold ${formatCurrency(interview.healthCoverAmount)} — a gap of ${formatCurrency(healthCover - interview.healthCoverAmount)}.`
                  : "You have none. This is the first thing the plan would fix."
              }
              status={
                !interview.hasHealthInsurance
                  ? { severity: "critical", label: "No cover" }
                  : interview.healthCoverAmount >= healthCover
                    ? { severity: "good", label: "Covered" }
                    : { severity: "warning", label: "Short" }
              }
            />
            <Implication
              term="Term life cover"
              detail={termCover === 0 ? "Not needed" : formatCurrency(termCover)}
              why={
                termCover === 0
                  ? "Nobody depends on your income, so life cover would be paying for a risk you do not carry."
                  : "Roughly ten years of income plus your outstanding debt."
              }
              status={
                termCover === 0
                  ? undefined
                  : interview.termCoverAmount >= termCover
                    ? { severity: "good", label: "Covered" }
                    : { severity: "serious", label: "Short" }
              }
            />
            <Implication
              term="Expensive debt"
              detail={
                interview.totalDebt > 0
                  ? `${formatCurrency(interview.totalDebt)} at up to ${formatPercent(interview.highestDebtRate, 0)}`
                  : "None"
              }
              why={
                interview.highestDebtRate >= 0.12
                  ? "Paying this down is a guaranteed return that beats what the market is likely to give you, so the plan clears it before investing."
                  : "Nothing here outranks investing."
              }
              status={
                interview.highestDebtRate >= 0.2
                  ? { severity: "critical", label: "Clear this first" }
                  : interview.highestDebtRate >= 0.12
                    ? { severity: "warning", label: "Prioritise" }
                    : undefined
              }
            />
          </dl>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {INTERVIEW_STEPS.map((step, i) => (
          <Button key={step.id} variant="ghost" onClick={() => onEdit(i)}>
            {step.title}
          </Button>
        ))}
      </div>
    </>
  );
}

function Implication({
  term,
  detail,
  why,
  status,
}: {
  term: string;
  detail: string;
  why: string;
  status?: { severity: AlertSeverity; label: string };
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <dt className="text-sm font-medium">{term}</dt>
        <dd className="text-sm font-semibold tabular">{detail}</dd>
      </div>
      {status ? (
        <p className="mt-1">
          <StatusMark severity={status.severity} label={status.label} />
        </p>
      ) : null}
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{why}</p>
    </div>
  );
}
