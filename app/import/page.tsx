"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ColumnMapper } from "@/components/import/ColumnMapper";
import { Dropzone } from "@/components/import/Dropzone";
import { ChoiceGroup, Field, Select, Toggle } from "@/components/ui/fields";
import {
  Button,
  Callout,
  Card,
  CardTitle,
  LinkButton,
  PageHeader,
} from "@/components/ui/primitives";
import { CheckCircleIcon, WarningIcon } from "@/components/ui/icons";
import { db } from "@/lib/db/db";
import { insertHoldings, insertTransactions, recordImport } from "@/lib/db/repositories";
import { overridesToMap } from "@/lib/categorize/classify";
import { buildHoldings } from "@/lib/import/buildHoldings";
import {
  buildTransactions,
  looksLikePositiveExpenseSheet,
  type RowError,
} from "@/lib/import/buildTransactions";
import {
  detectColumns,
  hasUsableAmount,
  HOLDING_FIELDS,
  missingRequired,
  TRANSACTION_FIELDS,
  type ColumnMapping,
  type RawSheet,
} from "@/lib/import/detect";
import { applyTransferFlags, detectTransfers } from "@/lib/import/transfers";
import { ImportError, readWorkbook } from "@/lib/import/readWorkbook";

type Mode = "transactions" | "holdings";

interface Summary {
  mode: Mode;
  rowsRead: number;
  imported: number;
  duplicates: number;
  errors: RowError[];
  ignored: number;
  transfers: number;
}

export default function ImportPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<RawSheet[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("transactions");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [account, setAccount] = useState("Main account");
  const [flipPositives, setFlipPositives] = useState(false);
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  const fields = mode === "transactions" ? TRANSACTION_FIELDS : HOLDING_FIELDS;
  const sheet = sheets?.[sheetIndex] ?? null;

  const detection = useMemo(
    () => (sheet ? detectColumns(sheet.rows, fields) : null),
    [sheet, fields],
  );

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setSummary(null);

    try {
      const parsed = await readWorkbook(file);
      setSheets(parsed);
      setFileName(file.name);
      setSheetIndex(0);

      const detected = detectColumns(parsed[0].rows, TRANSACTION_FIELDS);
      setMapping(detected.mapping);
      setFlipPositives(
        looksLikePositiveExpenseSheet(parsed[0].rows, detected.mapping, detected.headerRow),
      );
    } catch (caught) {
      setError(
        caught instanceof ImportError
          ? caught.message
          : "That file could not be read. If it opens in Excel or Sheets, try saving it as .xlsx and importing again.",
      );
      setSheets(null);
    } finally {
      setBusy(false);
    }
  }, []);

  function reDetect(nextMode: Mode, nextSheetIndex: number) {
    const target = sheets?.[nextSheetIndex];
    if (!target) return;
    const specs = nextMode === "transactions" ? TRANSACTION_FIELDS : HOLDING_FIELDS;
    const detected = detectColumns(target.rows, specs);
    setMapping(detected.mapping);
    setFlipPositives(
      nextMode === "transactions" &&
        looksLikePositiveExpenseSheet(target.rows, detected.mapping, detected.headerRow),
    );
  }

  const problems = useMemo(() => {
    if (!detection) return [];
    const list = missingRequired(mapping, fields).map((f) => `Pick a column for ${f.label}.`);
    if (mode === "transactions" && !hasUsableAmount(mapping)) {
      list.push("Pick either an Amount column, or a Debit and Credit pair.");
    }
    return list;
  }, [detection, mapping, fields, mode]);

  async function commit() {
    if (!sheet || !detection || problems.length > 0) return;

    setBusy(true);
    setError(null);

    try {
      const importId = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rowsRead = sheet.rows.length - detection.headerRow - 1;

      if (mode === "holdings") {
        const built = buildHoldings(sheet.rows, mapping, detection.headerRow, importId);
        const imported = await insertHoldings(built.holdings);

        await recordImport({
          id: importId,
          fileName,
          sheetName: sheet.name,
          importedAt: Date.now(),
          rowsRead,
          rowsImported: imported,
          rowsSkipped: built.errors.length,
          rowsDuplicate: 0,
        });

        setSummary({
          mode,
          rowsRead,
          imported,
          duplicates: 0,
          errors: built.errors,
          ignored: built.ignored,
          transfers: 0,
        });
      } else {
        const overrides = overridesToMap(await db().overrides.toArray());
        const built = buildTransactions(sheet.rows, {
          mapping,
          headerRow: detection.headerRow,
          importId,
          defaultAccount: account.trim() || "Main account",
          overrides,
          amountsArePositiveExpenses: flipPositives,
        });

        let rows = built.transactions;
        let transfers = 0;
        if (excludeTransfers) {
          // Detect against what is already stored as well, so a transfer whose
          // two legs arrived in separate imports still pairs up.
          const existing = await db().transactions.toArray();
          const flags = detectTransfers([...existing, ...rows]);
          const flagged = new Set(flags.map((f) => f.hash));
          transfers = rows.filter((r) => flagged.has(r.hash)).length;
          rows = applyTransferFlags(rows, flags);
        }

        const result = await insertTransactions(rows);

        await recordImport({
          id: importId,
          fileName,
          sheetName: sheet.name,
          importedAt: Date.now(),
          rowsRead,
          rowsImported: result.imported,
          rowsSkipped: built.errors.length,
          rowsDuplicate: result.duplicates,
        });

        setSummary({
          mode,
          rowsRead,
          imported: result.imported,
          duplicates: result.duplicates,
          errors: built.errors,
          ignored: built.ignored,
          transfers,
        });
      }

      setSheets(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Import failed: ${caught.message}`
          : "Import failed for an unknown reason.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return <ImportSummary summary={summary} onAnother={() => setSummary(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Import"
        lede="Drop in a bank statement, an expense sheet, or a portfolio export. Ledgr reads it here in your browser — the file is never uploaded."
      />

      {error ? (
        <div className="mb-6">
          <Callout tone="critical" title="That did not work">
            <p>{error}</p>
          </Callout>
        </div>
      ) : null}

      {!sheets ? (
        <div className="flex flex-col gap-6">
          <Dropzone onFile={handleFile} busy={busy} />

          <Card>
            <CardTitle hint="Ledgr handles the shapes real exports come in.">
              What it can read
            </CardTitle>
            <ul className="grid gap-2 text-sm text-ink-secondary sm:grid-cols-2">
              <li>Bank statements with a title block before the header</li>
              <li>Separate Debit and Credit columns, or one signed Amount</li>
              <li>Indian number formats — ₹1,50,000.00, 1,234 Dr, (1,234)</li>
              <li>DD/MM and MM/DD dates, worked out from the whole column</li>
              <li>Expense trackers where everything is a positive number</li>
              <li>Portfolio exports with units, cost and current value</li>
            </ul>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="File">
                <p className="truncate rounded-lg border border-hairline px-3 py-2 text-sm text-ink-secondary">
                  {fileName}
                </p>
              </Field>

              {sheets.length > 1 ? (
                <Field label="Sheet" htmlFor="sheet">
                  <Select
                    id="sheet"
                    value={sheetIndex}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setSheetIndex(next);
                      reDetect(mode, next);
                    }}
                  >
                    {sheets.map((s, i) => (
                      <option key={s.name} value={i}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              <Field label="This sheet contains">
                <ChoiceGroup
                  name="Import mode"
                  columns={1}
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    reDetect(next, sheetIndex);
                  }}
                  options={[
                    { value: "transactions", label: "Transactions" },
                    { value: "holdings", label: "Investment holdings" },
                  ]}
                />
              </Field>

              {mode === "transactions" ? (
                <Field
                  label="Account name"
                  htmlFor="account"
                  hint="Used when the sheet has no account column. Distinct names let Ledgr spot transfers between your accounts."
                >
                  <input
                    id="account"
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    className="w-full rounded-lg border border-hairline-strong bg-surface-raised px-3 py-2 text-sm"
                  />
                </Field>
              ) : null}
            </div>
          </Card>

          {detection && sheet ? (
            <Card>
              <ColumnMapper
                fields={fields}
                columns={detection.columns}
                mapping={mapping}
                confidence={detection.confidence}
                rows={sheet.rows}
                headerRow={detection.headerRow}
                onChange={setMapping}
                problems={problems}
              />
            </Card>
          ) : null}

          {mode === "transactions" ? (
            <Card>
              <CardTitle>Before importing</CardTitle>
              <div className="flex flex-col gap-4">
                <Toggle
                  checked={flipPositives}
                  onChange={setFlipPositives}
                  label="Every amount in this sheet is an expense"
                  hint="Turn on for expense trackers that list spending as positive numbers. Without it, a year of spending imports as a year of income."
                />
                <Toggle
                  checked={excludeTransfers}
                  onChange={setExcludeTransfers}
                  label="Detect transfers between my own accounts"
                  hint="Card bill payments and money moved into investments get marked as transfers and left out of income, expenses and the savings rate. You can change any of them afterwards."
                />
              </div>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || problems.length > 0} onClick={commit}>
              {busy ? "Importing…" : "Import this sheet"}
            </Button>
            <Button variant="ghost" onClick={() => setSheets(null)} disabled={busy}>
              Start over
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function ImportSummary({ summary, onAnother }: { summary: Summary; onAnother: () => void }) {
  const noun = summary.mode === "holdings" ? "holdings" : "transactions";

  return (
    <>
      <PageHeader
        title="Imported"
        lede={`Ledgr read ${summary.rowsRead} rows and added ${summary.imported} ${noun}.`}
        actions={
          <>
            <Button onClick={onAnother}>Import another</Button>
            <LinkButton
              variant="primary"
              href={summary.mode === "holdings" ? "/portfolio" : "/"}
            >
              {summary.mode === "holdings" ? "See your portfolio" : "See your dashboard"}
            </LinkButton>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Added" value={summary.imported} tone="good" />
        {summary.duplicates > 0 ? (
          <Stat
            label="Already had"
            value={summary.duplicates}
            hint="Skipped, so nothing is counted twice"
          />
        ) : null}
        {summary.transfers > 0 ? (
          <Stat
            label="Marked as transfers"
            value={summary.transfers}
            hint="Left out of income and expenses"
          />
        ) : null}
        {summary.ignored > 0 ? (
          <Stat label="Blank or totals" value={summary.ignored} hint="Not transactions" />
        ) : null}
        {summary.errors.length > 0 ? (
          <Stat label="Could not read" value={summary.errors.length} tone="warning" />
        ) : null}
      </div>

      {summary.errors.length > 0 ? (
        <Card>
          <CardTitle hint="Everything else imported. Fix these rows in your sheet and import it again — the rows already added will not duplicate.">
            <span className="inline-flex items-center gap-2">
              <WarningIcon size={16} />
              {summary.errors.length} rows Ledgr could not read
            </span>
          </CardTitle>

          <div className="overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full min-w-max text-left text-xs">
              <thead>
                <tr className="border-b border-hairline bg-wash">
                  <th className="px-3 py-2 font-semibold">Row</th>
                  <th className="px-3 py-2 font-semibold">Why</th>
                  <th className="px-3 py-2 font-semibold">Content</th>
                </tr>
              </thead>
              <tbody>
                {summary.errors.slice(0, 50).map((row) => (
                  <tr key={row.sheetRow} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 tabular">{row.sheetRow}</td>
                    <td className="px-3 py-2">{row.reason}</td>
                    <td className="max-w-md truncate px-3 py-2 text-ink-muted">
                      {row.preview}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary.errors.length > 50 ? (
            <p className="mt-3 text-xs text-ink-muted">
              Showing the first 50 of {summary.errors.length}.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card>
          <p className="flex items-center gap-2 text-sm">
            <span className="text-good">
              <CheckCircleIcon size={18} />
            </span>
            Every data row read cleanly.
          </p>
          <p className="mt-3 text-sm text-ink-secondary">
            Next, answer a few questions about your circumstances so Ledgr can build a plan
            around them.{" "}
            <Link href="/interview" className="font-medium text-series-1 underline">
              Start your profile
            </Link>
            .
          </p>
        </Card>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "good" | "warning";
}) {
  return (
    <Card>
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "good" ? "text-text-good" : "text-ink"}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  );
}
