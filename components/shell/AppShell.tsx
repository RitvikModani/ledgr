"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MenuIcon } from "@/components/ui/icons";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertRunner } from "@/components/alerts/AlertRunner";
import { ThemeToggle } from "./ThemeToggle";
import { NAV_ITEMS } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <AlertRunner />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface-raised focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between border-b border-hairline px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-secondary"
          aria-expanded={mobileOpen}
          aria-controls="primary-nav"
          aria-label="Toggle navigation"
        >
          <MenuIcon />
        </button>
        <Wordmark />
        <ThemeToggle />
      </header>

      <nav
        id="primary-nav"
        aria-label="Primary"
        className={`${
          mobileOpen ? "block" : "hidden"
        } border-b border-hairline bg-surface px-3 py-3 lg:sticky lg:top-0 lg:block lg:h-dvh lg:border-r lg:border-b-0 lg:px-4 lg:py-5`}
      >
        <div className="mb-6 hidden items-center justify-between lg:flex">
          <Wordmark />
          <ThemeToggle />
        </div>

        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  // Closed here rather than in an effect on pathname: the drawer
                  // must not stay open over the page the user just asked for.
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-wash font-semibold text-ink"
                      : "text-ink-secondary hover:bg-wash hover:text-ink"
                  }`}
                >
                  <Icon />
                  <span className="flex-1">{item.label}</span>
                  {item.href === "/alerts" ? <AlertBadge /> : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 px-3 text-xs leading-relaxed text-ink-muted">
          Your data stays in this browser. Nothing is uploaded unless you turn on email
          digests.
        </p>
      </nav>

      <main id="main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 rounded-[6px] bg-series-1"
        style={{
          maskImage: "linear-gradient(135deg,#000 45%,transparent 45%)",
          WebkitMaskImage: "linear-gradient(135deg,#000 45%,transparent 45%)",
          background:
            "linear-gradient(135deg, var(--series-1) 0 50%, var(--series-3) 50% 100%)",
        }}
      />
      Ledgr
    </Link>
  );
}
