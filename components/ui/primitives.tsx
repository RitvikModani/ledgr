import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {lede ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-secondary">{lede}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
}) {
  return (
    <Tag
      className={`rounded-xl border border-hairline bg-surface p-4 sm:p-5 ${className}`}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({
  children,
  hint,
  actions,
}: {
  children: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
        {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-1">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-series-1 text-white hover:opacity-90",
  secondary: "border border-hairline-strong text-ink hover:bg-wash",
  ghost: "text-ink-secondary hover:bg-wash hover:text-ink",
  danger: "border border-critical text-critical hover:bg-critical hover:text-white",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-hairline-strong px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-ink-muted">{icon}</div> : null}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">{body}</p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-wash ${className}`}
      aria-hidden="true"
    />
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "critical";
  title?: string;
  children: ReactNode;
}) {
  const border =
    tone === "critical"
      ? "border-critical"
      : tone === "warning"
        ? "border-warning"
        : "border-hairline-strong";

  return (
    <div className={`rounded-lg border-l-2 ${border} bg-wash px-4 py-3 text-sm`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className="text-ink-secondary [&>p+p]:mt-2">{children}</div>
    </div>
  );
}

/**
 * The investment pages carry this permanently.
 *
 * Ledgr models allocations and returns; it is not a registered adviser and does
 * not know the user's full circumstances. Saying so once, visibly, on every page
 * that recommends anything is the honest minimum.
 */
export function AdviceDisclaimer() {
  return (
    <p className="rounded-lg border border-hairline bg-wash px-4 py-3 text-xs leading-relaxed text-ink-secondary">
      <strong className="font-semibold text-ink">Educational, not advice.</strong> Ledgr
      models asset-class allocations and instrument categories from the answers you gave
      it. It is not a SEBI-registered investment adviser, does not know your full
      circumstances, and never recommends a specific fund or scheme. Returns shown are
      assumptions you can change, not forecasts. Check anything material with a qualified
      adviser before acting on it.
    </p>
  );
}
