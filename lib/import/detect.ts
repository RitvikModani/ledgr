import { cellToText, parseAmount, parseDate, type RawCell } from "./coerce";

export type RawRow = RawCell[];

export interface RawSheet {
  name: string;
  rows: RawRow[];
}

/** What a column can mean. Shared by the transaction and holdings profiles. */
export type FieldRole =
  // transactions
  | "date"
  | "description"
  | "amount"
  | "debit"
  | "credit"
  | "balance"
  | "category"
  | "account"
  // holdings
  | "assetName"
  | "assetType"
  | "units"
  | "avgCost"
  | "currentValue"
  | "purchaseDate";

export interface FieldSpec {
  role: FieldRole;
  label: string;
  /** Header words that identify this column, strongest first. */
  keywords: string[];
  /** What the cells should look like. Used when headers are unhelpful. */
  shape: "date" | "number" | "text";
  required: boolean;
  help?: string;
}

export const TRANSACTION_FIELDS: FieldSpec[] = [
  {
    role: "date",
    label: "Date",
    keywords: ["date", "txn date", "transaction date", "value date", "posting date", "booking date"],
    shape: "date",
    required: true,
  },
  {
    role: "description",
    label: "Description",
    keywords: ["description", "narration", "particulars", "details", "remarks", "transaction remarks", "merchant", "payee"],
    shape: "text",
    required: true,
  },
  {
    role: "amount",
    label: "Amount",
    keywords: ["amount", "transaction amount", "value", "net amount"],
    shape: "number",
    required: false,
    help: "One signed column. Leave unset if the sheet has separate debit and credit columns.",
  },
  {
    role: "debit",
    label: "Debit / Withdrawal",
    keywords: ["debit", "withdrawal", "withdrawal amt", "dr", "paid out", "outflow", "expense"],
    shape: "number",
    required: false,
  },
  {
    role: "credit",
    label: "Credit / Deposit",
    keywords: ["credit", "deposit", "deposit amt", "cr", "paid in", "inflow", "income"],
    shape: "number",
    required: false,
  },
  {
    role: "balance",
    label: "Balance",
    keywords: ["balance", "closing balance", "running balance", "available balance"],
    shape: "number",
    required: false,
  },
  {
    role: "category",
    label: "Category",
    keywords: ["category", "type", "head", "classification", "tag"],
    shape: "text",
    required: false,
  },
  {
    role: "account",
    label: "Account",
    keywords: ["account", "account no", "bank", "source", "card"],
    shape: "text",
    required: false,
  },
];

export const HOLDING_FIELDS: FieldSpec[] = [
  {
    role: "assetName",
    label: "Asset name",
    keywords: ["name", "scheme", "scheme name", "fund", "security", "instrument", "stock", "asset", "holding"],
    shape: "text",
    required: true,
  },
  {
    role: "assetType",
    label: "Asset type",
    keywords: ["type", "category", "asset class", "class", "kind", "segment"],
    shape: "text",
    required: false,
  },
  {
    role: "units",
    label: "Units / Quantity",
    keywords: ["units", "quantity", "qty", "no of units", "shares", "balance units"],
    shape: "number",
    required: false,
  },
  {
    role: "avgCost",
    label: "Average cost",
    keywords: ["avg cost", "average cost", "cost", "buy price", "purchase price", "nav at cost", "avg nav", "invested"],
    shape: "number",
    required: false,
  },
  {
    role: "currentValue",
    label: "Current value",
    keywords: ["current value", "market value", "value", "present value", "current amount", "valuation"],
    shape: "number",
    required: true,
  },
  {
    role: "purchaseDate",
    label: "Purchase date",
    keywords: ["purchase date", "buy date", "date", "invested on", "start date"],
    shape: "date",
    required: false,
  },
];

/** role -> column index. -1 means "not mapped". */
export type ColumnMapping = Partial<Record<FieldRole, number>>;

export interface ColumnProfile {
  index: number;
  header: string;
  dateRatio: number;
  numberRatio: number;
  textRatio: number;
  filledRatio: number;
  distinctRatio: number;
}

export interface DetectionResult {
  headerRow: number;
  columns: ColumnProfile[];
  mapping: ColumnMapping;
  /** role -> 0..1, how sure the guess is. Shown next to each field in the mapper. */
  confidence: Partial<Record<FieldRole, number>>;
}

const MAX_HEADER_SCAN = 15;
const SAMPLE_ROWS = 40;

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Finds the header row.
 *
 * Real bank exports rarely start at row 1 — there is usually a title block,
 * an account number, a statement period, and a blank line first. Assuming row 1
 * is the header is the single most common way a bank statement import fails, so
 * this scans the first 15 rows and scores each on how header-like it is: mostly
 * short text, few numbers or dates, no blanks in the middle, and ideally some
 * recognisable field words.
 */
export function findHeaderRow(rows: RawRow[], fields: FieldSpec[]): number {
  const allKeywords = new Set(fields.flatMap((f) => f.keywords));
  let bestRow = 0;
  let bestScore = -Infinity;

  const limit = Math.min(MAX_HEADER_SCAN, rows.length);
  for (let r = 0; r < limit; r++) {
    const cells = rows[r] ?? [];
    const texts = cells.map((c) => normalizeHeader(cellToText(c)));
    const filled = texts.filter((t) => t.length > 0);
    if (filled.length < 2) continue;

    let score = 0;

    // Recognisable field words are the strongest signal.
    for (const text of filled) {
      if (allKeywords.has(text)) score += 6;
      else if ([...allKeywords].some((k) => text.includes(k) || k.includes(text))) score += 3;
    }

    // Headers are short labels, not data.
    const shortLabels = filled.filter((t) => t.length <= 28).length;
    score += (shortLabels / filled.length) * 3;

    // Data-shaped cells argue against this being the header.
    const dataLike = cells.filter(
      (c) => parseDate(c) !== null || (typeof c === "number" && Math.abs(c) > 1000),
    ).length;
    score -= dataLike * 2.5;

    // Wider rows are more likely to be the real header than a stray title cell.
    score += Math.min(filled.length, 8) * 0.4;

    // Prefer the earliest strong candidate, so a repeated header block deeper in
    // the sheet does not win over the real one.
    score -= r * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return bestRow;
}

export function profileColumns(rows: RawRow[], headerRow: number): ColumnProfile[] {
  const header = rows[headerRow] ?? [];
  const body = rows.slice(headerRow + 1, headerRow + 1 + SAMPLE_ROWS);
  const width = Math.max(header.length, ...body.map((r) => r.length), 0);

  const profiles: ColumnProfile[] = [];

  for (let c = 0; c < width; c++) {
    const cells = body.map((r) => r[c]);
    const filled = cells.filter((v) => v !== null && v !== undefined && cellToText(v) !== "");
    const total = filled.length || 1;

    const dates = filled.filter((v) => parseDate(v) !== null).length;
    // A cell that parses as a date is not counted as a number too — otherwise
    // every date column looks like a plausible amount column.
    const numbers = filled.filter((v) => parseDate(v) === null && parseAmount(v) !== null).length;
    const texts = filled.filter(
      (v) => parseDate(v) === null && parseAmount(v) === null,
    ).length;
    const distinct = new Set(filled.map((v) => cellToText(v))).size;

    profiles.push({
      index: c,
      header: cellToText(header[c]) || `Column ${c + 1}`,
      dateRatio: dates / total,
      numberRatio: numbers / total,
      textRatio: texts / total,
      filledRatio: filled.length / (body.length || 1),
      distinctRatio: distinct / total,
    });
  }

  return profiles;
}

function headerScore(header: string, spec: FieldSpec): number {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;

  for (let i = 0; i < spec.keywords.length; i++) {
    const keyword = spec.keywords[i];
    // Earlier keywords in the list are the more canonical names.
    const rank = 1 - i / (spec.keywords.length * 2);
    if (normalized === keyword) return 10 * rank;
    if (normalized.startsWith(keyword) || normalized.endsWith(keyword)) return 8 * rank;
    if (normalized.includes(keyword)) return 6 * rank;
  }
  return 0;
}

function shapeScore(column: ColumnProfile, spec: FieldSpec): number {
  switch (spec.shape) {
    case "date":
      return column.dateRatio * 6;
    case "number":
      return column.numberRatio * 5;
    case "text":
      // A description column is text and nearly all distinct; a category or
      // account column is text and highly repetitive. distinctRatio separates
      // them when the headers are unhelpful.
      return (
        column.textRatio * 4 +
        (spec.role === "description" ? column.distinctRatio * 2 : (1 - column.distinctRatio) * 2)
      );
  }
}

/**
 * Assigns columns to roles.
 *
 * Greedy over the strongest (role, column) pair rather than per-role best,
 * because a sheet with both "Debit" and "Credit" columns will otherwise hand
 * both to whichever role is checked first.
 */
export function detectColumns(rows: RawRow[], fields: FieldSpec[]): DetectionResult {
  const headerRow = findHeaderRow(rows, fields);
  const columns = profileColumns(rows, headerRow);

  const candidates: Array<{ role: FieldRole; index: number; score: number }> = [];
  for (const spec of fields) {
    for (const column of columns) {
      if (column.filledRatio < 0.05) continue;
      const score = headerScore(column.header, spec) + shapeScore(column, spec);
      if (score > 0) candidates.push({ role: spec.role, index: column.index, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = {};
  const confidence: Partial<Record<FieldRole, number>> = {};
  const takenRoles = new Set<FieldRole>();
  const takenColumns = new Set<number>();

  for (const candidate of candidates) {
    if (takenRoles.has(candidate.role) || takenColumns.has(candidate.index)) continue;
    // Below this, the "match" is shape noise rather than evidence, and a wrong
    // guess costs the user more than an empty field they can fill in.
    if (candidate.score < 3) continue;

    mapping[candidate.role] = candidate.index;
    confidence[candidate.role] = Math.min(1, candidate.score / 12);
    takenRoles.add(candidate.role);
    takenColumns.add(candidate.index);
  }

  // A sheet with debit and credit columns does not also have a signed amount
  // column; whichever the detector liked less is a misfire.
  if (mapping.debit !== undefined && mapping.credit !== undefined) {
    const amountConfidence = confidence.amount ?? 0;
    if (amountConfidence < Math.max(confidence.debit ?? 0, confidence.credit ?? 0)) {
      delete mapping.amount;
      delete confidence.amount;
    }
  }

  return { headerRow, columns, mapping, confidence };
}

/** Which required roles are still unmapped. Drives the mapper's Continue button. */
export function missingRequired(
  mapping: ColumnMapping,
  fields: FieldSpec[],
): FieldSpec[] {
  return fields.filter((f) => f.required && mapping[f.role] === undefined);
}

/** A transaction sheet needs either a signed amount or a debit/credit pair. */
export function hasUsableAmount(mapping: ColumnMapping): boolean {
  return (
    mapping.amount !== undefined ||
    mapping.debit !== undefined ||
    mapping.credit !== undefined
  );
}
