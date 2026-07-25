# Ledgr

Turn your own spreadsheets into a financial plan.

Ledgr reads a bank statement or expense sheet, charts where the money actually went,
interviews you about your circumstances, and builds a plan from the answers — budget,
goals, investment allocation, and alerts when something needs attention.

**Everything runs in your browser.** Transactions, goals, holdings and answers live in
IndexedDB on your device. There is no account, no server database, and nothing is uploaded
— with one exception you have to switch on yourself (see [Privacy](#privacy)).

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000. With no data loaded, the dashboard offers a sample
dataset so you can see the whole app working before handing it anything real.

## What it does

| Area | |
|---|---|
| **Import** | Reads `.xlsx`, `.xlsm` and `.csv`. Guesses which columns are the date, description and amount, then shows you the mapping so you can correct it. Handles Indian number formats (`1,50,000.00`), `Dr`/`Cr` suffixes, bracketed negatives, and split debit/credit columns. Re-importing an overlapping statement adds only the new rows. |
| **Dashboard** | Cash flow, savings rate, runway, spending by category, category trend over time, running balance, budget vs actual. Every chart has a table view. |
| **Your profile** | A fact-find covering your age, income, obligations, protection, existing investments and outlook. Every question is skippable and everything it drives says so when it is running on a default rather than your answer. |
| **Goals** | Emergency fund, home, retirement, education, vehicle, travel, debt payoff or custom. Required monthly contribution, projected corpus, and whether you are on track. |
| **Plan** | Auto-budget derived from your own spending history, long-horizon projections, and a what-if simulator — change your income, cut a category, shift a target date, and watch the projection move. |
| **Invest** | A target allocation across equity, debt, gold and cash from your risk profile, mapped to instrument categories, with per-goal SIP amounts and a glide path that de-risks as each goal approaches. |
| **Portfolio** | Import or enter your holdings. Current value, absolute return, XIRR, and how far your actual allocation has drifted from target. |
| **Alerts** | Overspending, budget pace, thin runway, off-track goals, falling savings rate, unusual transactions, upcoming bills, duplicate entries, allocation drift and more. In-app, optional browser notifications, optional email digest. |

## Privacy

Your financial data does not leave your device unless you explicitly turn on **email
digests** in Settings. That feature exists because it was asked for; it is off by default,
it asks for your email address rather than storing an account, and it sends aggregate
figures and alert text — never a table of your transactions.

Everything else — parsing, charting, projections, risk scoring, XIRR — is computed locally
in the browser. There is no analytics, no telemetry, and no third-party script.

The flip side of local-first is that **your data is exactly as durable as this browser
profile**. Clearing site data deletes it. Settings has an export button; use it.

## Scripts

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run generate:samples` | Regenerate the sample and template spreadsheets |

## Email digests

Digests are relayed by `app/api/digest/route.ts` through [Resend](https://resend.com). Set:

```
RESEND_API_KEY=...
RESEND_FROM="Ledgr <ledgr@yourdomain.com>"
```

Without a key the route returns 503 and Settings shows email delivery as unavailable —
the rest of the app is unaffected.

Because there are no accounts, digests are sent when you open the app and one is due,
rather than by a server-side schedule. Truly scheduled digests would need Ledgr to store
your email address and a snapshot of your data on a server, which is the trade this design
deliberately avoids.

## Design notes

Charts follow one system rather than per-chart taste: colour is assigned by the job it
does (categorical for identity, sequential for magnitude, diverging for polarity, a
reserved status palette for state), hues are assigned in a fixed order and never cycled,
and the palette was validated for colour-vision deficiency and contrast against the exact
light and dark surfaces the app renders on. No chart uses two y-axes. Every chart has a
table view, and status is always carried by an icon and a label as well as a colour.

## Stack

Next.js 15 · TypeScript · Tailwind CSS 4 · Dexie (IndexedDB) · ExcelJS · Recharts · Vitest ·
Playwright

## Not investment advice

Ledgr is an educational planning tool. It models asset-class allocations and instrument
categories from the answers you give it. It is not a registered investment adviser, does
not know your full circumstances, and never recommends a specific fund or scheme. The
returns it shows are assumptions you control, not forecasts.

### Dependency advisories

`npm audit` reports a `brace-expansion` DoS advisory reaching the project through
`minimatch@3` — pulled in by ESLint's plugin chain and by `archiver`, which ExcelJS uses on
its *write* path. The only patched release line, `brace-expansion@5`, changed its export
shape and breaks `minimatch@3` at runtime, and ESLint 10 (which would drop the old chain)
is not yet compatible with `eslint-config-next@16`. The advisory needs attacker-controlled
glob patterns to trigger; nothing in Ledgr passes user input to a glob. Overrides are in
place for the advisories that *could* matter — `sharp`, `postcss` and `uuid` — and this one
is revisited when the upstream chain moves.
