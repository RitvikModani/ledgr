import { matchesKeyword } from "@/lib/categorize/keywords";
import { todayISO } from "@/lib/format/date";
import type { AssetClass, Holding, InstrumentCategory } from "@/lib/db/types";
import { cellToText, detectDateOrder, parseAmount, parseDate } from "./coerce";
import type { ColumnMapping, RawRow } from "./detect";
import type { RowError } from "./buildTransactions";

export interface HoldingBuildResult {
  holdings: Holding[];
  errors: RowError[];
  ignored: number;
}

interface InstrumentGuess {
  instrument: InstrumentCategory;
  assetClass: AssetClass;
  keywords: string[];
}

/**
 * Maps what a broker or fund house calls a holding onto Ledgr's instrument
 * categories. Order matters — narrower names first, so "gold etf" is not caught
 * by the generic "etf" rule and filed as equity.
 */
const INSTRUMENT_GUESSES: InstrumentGuess[] = [
  { instrument: "sgb", assetClass: "gold", keywords: ["sovereign gold", "sgb"] },
  { instrument: "gold-etf", assetClass: "gold", keywords: ["gold", "silver", "bullion"] },
  { instrument: "elss", assetClass: "equity", keywords: ["elss", "tax saver", "taxsaver", "long term equity"] },
  { instrument: "index-fund", assetClass: "equity", keywords: ["index", "nifty", "sensex", "etf", "passive"] },
  { instrument: "international-equity", assetClass: "equity", keywords: ["nasdaq", "s&p 500", "us equity", "global", "international", "world"] },
  { instrument: "flexi-cap-fund", assetClass: "equity", keywords: ["flexi", "multi cap", "multicap", "large cap", "mid cap", "small cap", "bluechip", "focused", "value fund", "equity fund"] },
  { instrument: "ppf", assetClass: "debt", keywords: ["ppf", "public provident"] },
  { instrument: "epf", assetClass: "debt", keywords: ["epf", "employee provident", "vpf", "provident fund"] },
  { instrument: "nps", assetClass: "debt", keywords: ["nps", "national pension"] },
  { instrument: "liquid-fund", assetClass: "cash", keywords: ["liquid", "overnight", "money market", "ultra short"] },
  { instrument: "debt-fund", assetClass: "debt", keywords: ["debt", "gilt", "bond", "corporate", "banking psu", "dynamic bond", "income fund"] },
  { instrument: "fixed-deposit", assetClass: "debt", keywords: ["fixed deposit", "fd", "term deposit", "recurring deposit"] },
  { instrument: "savings-account", assetClass: "cash", keywords: ["savings", "cash", "bank balance"] },
  { instrument: "reit", assetClass: "real-estate", keywords: ["reit", "invit", "real estate"] },
  { instrument: "direct-stocks", assetClass: "equity", keywords: ["stock", "share", "equity", "ltd", "limited"] },
];

/**
 * Classifies a holding from its name and whatever the sheet's type column said.
 *
 * Falls back to equity because an unrecognised holding in a retail portfolio is
 * far more often a stock or an equity fund than anything else — and because
 * putting an unknown into equity is the conservative direction for a drift
 * warning, which will flag it rather than quietly ignoring it.
 */
export function guessInstrument(
  name: string,
  declaredType?: string,
): { instrument: InstrumentCategory; assetClass: AssetClass } {
  const haystack = ` ${name} ${declaredType ?? ""} `.toLowerCase();

  for (const guess of INSTRUMENT_GUESSES) {
    if (guess.keywords.some((k) => matchesKeyword(haystack, k))) {
      return { instrument: guess.instrument, assetClass: guess.assetClass };
    }
  }

  return { instrument: "other", assetClass: "equity" };
}

export function buildHoldings(
  rows: RawRow[],
  mapping: ColumnMapping,
  headerRow: number,
  importId: string,
): HoldingBuildResult {
  const body = rows.slice(headerRow + 1);
  const holdings: Holding[] = [];
  const errors: RowError[] = [];
  let ignored = 0;

  const dateColumn = mapping.purchaseDate;
  const dateOrder =
    dateColumn === undefined ? "day-first" : detectDateOrder(body.map((r) => r[dateColumn]));

  body.forEach((row, i) => {
    const sheetRow = headerRow + 2 + i;
    const preview = row.map(cellToText).filter(Boolean).join(" | ").slice(0, 90);
    if (!preview) {
      ignored++;
      return;
    }
    if (/^\s*(total|grand total|sub[- ]?total)/i.test(preview)) {
      ignored++;
      return;
    }

    const name =
      mapping.assetName === undefined ? "" : cellToText(row[mapping.assetName]).slice(0, 120);
    if (!name) {
      errors.push({ sheetRow, reason: "No asset name", preview });
      return;
    }

    const currentValue =
      mapping.currentValue === undefined ? null : parseAmount(row[mapping.currentValue]);
    if (currentValue === null) {
      errors.push({ sheetRow, reason: "No readable current value", preview });
      return;
    }
    if (currentValue === 0) {
      ignored++;
      return;
    }

    const units = mapping.units === undefined ? null : parseAmount(row[mapping.units]);
    const rawCost = mapping.avgCost === undefined ? null : parseAmount(row[mapping.avgCost]);
    const declaredType =
      mapping.assetType === undefined ? undefined : cellToText(row[mapping.assetType]);

    // Some exports give a per-unit cost, others give the total invested. If the
    // "cost" is larger than one unit's share of current value by orders of
    // magnitude, it is the total — divide it back down.
    let avgCost = rawCost ?? 0;
    let resolvedUnits = units ?? 0;
    if (resolvedUnits > 0 && rawCost !== null) {
      const impliedTotal = rawCost * resolvedUnits;
      const looksLikeTotal = rawCost > 0 && impliedTotal > currentValue * 20;
      if (looksLikeTotal) avgCost = rawCost / resolvedUnits;
    } else if (resolvedUnits === 0) {
      // No units column: model the holding as one unit so invested amount and
      // current value still work out.
      resolvedUnits = 1;
      avgCost = rawCost ?? currentValue;
    }

    const purchaseDate =
      (dateColumn === undefined ? null : parseDate(row[dateColumn], dateOrder)) ?? todayISO();

    const { instrument, assetClass } = guessInstrument(name, declaredType);

    holdings.push({
      name,
      assetClass,
      instrument,
      units: resolvedUnits,
      avgCost,
      currentValue,
      purchaseDate,
      updatedAt: Date.now(),
      importId,
    });
  });

  return { holdings, errors, ignored };
}
