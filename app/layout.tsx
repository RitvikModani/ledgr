import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeScript } from "@/components/shell/ThemeScript";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgr — your money, planned",
  description:
    "Turn your own spreadsheets into a financial plan. Charts, goals, investments and alerts, all computed in your browser.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: ThemeScript stamps data-theme before React
    // hydrates, so the server and client html attributes intentionally differ.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
