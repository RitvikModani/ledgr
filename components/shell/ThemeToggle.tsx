"use client";

import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { THEME_STORAGE_KEY } from "./ThemeScript";

/**
 * Theme toggle with no React state at all.
 *
 * The current theme lives in one place — the data-theme attribute on <html>,
 * stamped before first paint. Mirroring it into component state would mean the
 * server renders one icon, the client corrects it after hydration, and the icon
 * visibly flips. Instead both icons are rendered and CSS shows the right one, so
 * it is correct from the very first frame.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-browsing modes can refuse storage. The theme still applies for
      // this session; it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline text-ink-secondary transition-colors hover:bg-wash hover:text-ink"
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
      <span className="sr-only dark:hidden">Switch to dark theme</span>
      <span className="sr-only hidden dark:inline">Switch to light theme</span>
    </button>
  );
}
