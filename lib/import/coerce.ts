import { toISODate, type ISODate } from "@/lib/format/date";

export type RawCell = string | number | boolean | Date | null | undefined;

/* -------------------------------------------------------------------------- */
/* Amounts                                                                    */
/* -------------------------------------------------------------------------- */

const CURRENCY_NOISE = /(?:₹|rs\.?|inr|\$|€|£)/gi;
// Regular spaces, non-breaking spaces, and the narrow no-break space Excel likes.
const SPACES = /[\s  ]/g;

/**
 * Parses an amount cell into a number, or null when the cell is not an amount.
 *
 * Real statements are messier than they look. This handles, in one pass:
 *   "₹1,50,000.00"   Indian grouping and a currency symbol
 *   "(1,234)"        accounting negatives
 *   "1,234.00 Dr"    debit/credit suffixes, which flip the sign
 *   "1.234,56"       European decimal comma
 *   "1,234-"         trailing minus
 *
 * Returning null rather than 0 for junk matters: a failed parse must show up in
 * the import summary as a skipped row, not silently become a zero-value
 * transaction that drags every average down.
 */
export function parseAmount(raw: RawCell): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "boolean" || raw instanceof Date) return null;

  let text = String(raw).trim();
  if (!text) return null;

  let sign = 1;

  // Dr/Cr markers, which some banks put on either side of the number.
  const drCr = text.match(/(?:^|[\s(])(dr|cr)\b|\b(dr|cr)\.?\s*$/i);
  if (drCr) {
    const marker = (drCr[1] ?? drCr[2] ?? "").toLowerCase();
    if (marker === "dr") sign = -1;
    text = text.replace(/\b(dr|cr)\.?/gi, "");
  }

  // Accounting negatives.
  if (/^\(.*\)$/.test(text.trim())) {
    sign = -1;
    text = text.trim().slice(1, -1);
  }

  text = text.replace(CURRENCY_NOISE, "").replace(SPACES, "");

  // Trailing minus, used by some exports instead of a leading one.
  if (text.endsWith("-")) {
    sign = -1;
    text = text.slice(0, -1);
  }
  if (text.startsWith("-")) {
    sign = -1;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!text) return null;

  text = normaliseDecimalSeparator(text);

  if (!/^\d*\.?\d+$/.test(text)) return null;

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return sign * value;
}

/**
 * Decides whether commas and dots are grouping or decimal marks.
 *
 * Indian grouping ("1,50,000.00") and European decimals ("1.234,56") are
 * genuinely ambiguous in isolation, so the rule is positional: whichever
 * separator appears last is the decimal point, and only if what follows it is
 * short enough to be a fractional part.
 */
function normaliseDecimalSeparator(text: string): string {
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma === -1 && lastDot === -1) return text;

  if (lastComma > lastDot) {
    const decimals = text.length - lastComma - 1;
    if (decimals <= 2) {
      return text.slice(0, lastComma).replace(/[.,]/g, "") + "." + text.slice(lastComma + 1);
    }
    return text.replace(/,/g, "");
  }

  const decimals = text.length - lastDot - 1;
  if (lastDot !== -1 && decimals <= 2) {
    return text.slice(0, lastDot).replace(/[.,]/g, "") + "." + text.slice(lastDot + 1);
  }
  return text.replace(/[.,]/g, "");
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

export type DateOrder = "day-first" | "month-first";

const MONTH_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Excel's day 1 is 1900-01-01, offset by its deliberate 1900 leap-year bug. */
const EXCEL_EPOCH_OFFSET_DAYS = 25_569;

function fromExcelSerial(serial: number): ISODate | null {
  if (serial < 1 || serial > 200_000) return null;
  const ms = (serial - EXCEL_EPOCH_OFFSET_DAYS) * 86_400_000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  // Serials carry no timezone, so read the UTC fields and rebuild locally.
  return toISODate(
    new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function build(year: number, month: number, day: number): ISODate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const full = year < 100 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
  const date = new Date(full, month - 1, day);
  // Rejects impossible dates like 31 February, which JS would roll forward.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return toISODate(date);
}

/**
 * Parses a date cell. `order` resolves the DD/MM vs MM/DD ambiguity and should
 * come from detectDateOrder() run over the whole column, not guessed per cell.
 */
export function parseDate(raw: RawCell, order: DateOrder = "day-first"): ISODate | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : toISODate(raw);
  }
  if (typeof raw === "number") return fromExcelSerial(raw);
  if (typeof raw === "boolean") return null;

  const text = String(raw).trim();
  if (!text) return null;

  // ISO first — unambiguous, so it never goes through the order heuristic.
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Named months: "01-Apr-2026", "1 April 26", "Apr 1, 2026".
  const named = text.match(/^(\d{1,2})[\s\-/]*([a-z]{3,9})[\s\-/,]*(\d{2,4})$/i);
  if (named) {
    const month = MONTH_ABBR[named[2].slice(0, 4).toLowerCase()] ?? MONTH_ABBR[named[2].slice(0, 3).toLowerCase()];
    if (month) return build(Number(named[3]), month, Number(named[1]));
  }
  const namedFirst = text.match(/^([a-z]{3,9})[\s\-/]*(\d{1,2})[\s\-/,]*(\d{2,4})$/i);
  if (namedFirst) {
    const month = MONTH_ABBR[namedFirst[1].slice(0, 4).toLowerCase()] ?? MONTH_ABBR[namedFirst[1].slice(0, 3).toLowerCase()];
    if (month) return build(Number(namedFirst[3]), month, Number(namedFirst[2]));
  }

  // Numeric, separator-agnostic.
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = Number(numeric[3]);
    // A component above 12 settles it regardless of the column's usual order.
    if (a > 12) return build(year, b, a);
    if (b > 12) return build(year, a, b);
    return order === "day-first" ? build(year, b, a) : build(year, a, b);
  }

  return null;
}

/**
 * Infers DD/MM vs MM/DD by looking at the whole column.
 *
 * A single "05/04/2026" is unknowable, but a column containing "13/04/2026"
 * somewhere is settled: 13 cannot be a month. Only when no cell disambiguates
 * does this fall back to day-first, which is the Indian convention and the
 * dominant one outside the US.
 */
export function detectDateOrder(cells: RawCell[]): DateOrder {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const cell of cells) {
    if (typeof cell !== "string") continue;
    const match = cell.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!match) continue;
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (a > 12 && b <= 12) dayFirstEvidence++;
    else if (b > 12 && a <= 12) monthFirstEvidence++;
  }

  return monthFirstEvidence > dayFirstEvidence ? "month-first" : "day-first";
}

/* -------------------------------------------------------------------------- */
/* Text                                                                       */
/* -------------------------------------------------------------------------- */

export function cellToText(raw: RawCell): string {
  if (raw === null || raw === undefined) return "";
  if (raw instanceof Date) return toISODate(raw);
  // ExcelJS hands back rich-text and formula objects rather than primitives.
  if (typeof raw === "object") {
    const obj = raw as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (typeof obj.text === "string") return obj.text;
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("");
    if (obj.result !== undefined) return String(obj.result);
    return "";
  }
  return String(raw).trim();
}

const REFERENCE_NOISE = [
  /@[\w.]+/g, // UPI handles: @okhdfcbank, @paytm, @ybl
  /\b(?:ref|txn|trn|utr|rrn|id|no|num)[.:# ]*\w*\d\w*/gi,
  /\b\d{2}[-/]\d{2}[-/]\d{2,4}\b/g, // dates embedded in the narration
  /\b[a-z0-9]*\d{4,}[a-z0-9]*\b/gi, // reference blobs, digits or mixed
  /\b\d+\b/g, // any remaining bare numbers
];

/** Payment rails and transaction-type codes. Present in most narrations, never the merchant. */
const RAIL_WORDS = new Set([
  "upi", "imps", "neft", "rtgs", "ach", "ecs", "nach", "pos", "atm", "vps",
  "mmt", "inb", "chq", "clg", "ft", "tfr", "trf", "bil", "bpay", "ecom",
  "p2a", "p2m", "p2p", "si", "mandate", "mps", "onl", "cms", "int", "sb",
]);

/**
 * Bank and PSP handle suffixes that ride along on UPI narrations. The same
 * merchant paid from two different apps otherwise looks like two merchants.
 */
const HANDLE_PATTERN = /^(?:ok[a-z]+|[a-z]{2,}bank|ybl|paytm|apl|axl|ibl|upi|yesb|axis|hdfc|icici|sbi|kotak|idfc)$/;

/**
 * Cities that routinely appear in card and UPI narrations as branch detail.
 * Bounded and deliberately short — this is branch noise, not an attempt to
 * enumerate Indian geography.
 */
const CITY_WORDS = new Set([
  "mumbai", "delhi", "newdelhi", "bangalore", "bengaluru", "hyderabad",
  "chennai", "kolkata", "pune", "ahmedabad", "surat", "jaipur", "lucknow",
  "kanpur", "nagpur", "indore", "thane", "bhopal", "visakhapatnam", "patna",
  "vadodara", "ghaziabad", "ludhiana", "agra", "nashik", "faridabad",
  "meerut", "rajkot", "varanasi", "srinagar", "aurangabad", "noida",
  "gurgaon", "gurugram", "chandigarh", "coimbatore", "kochi", "trivandrum",
  "guwahati", "mysore", "mysuru",
]);

/** Legal forms and filler that split one merchant into several. */
const FILLER_WORDS = new Set([
  "pvt", "ltd", "limited", "private", "llp", "inc", "co", "corp",
  "india", "indian", "in", "the", "and", "of",
  "payment", "payments", "paid", "pay", "to", "from", "by", "via", "for",
  "purchase", "txn", "transaction", "debit", "credit", "card",
]);

/**
 * Reduces a statement narration to a merchant key.
 *
 * "UPI/SWIGGY BANGALORE/428193847/OKHDFCBANK" and "UPI-SWIGGY-9928374-@okicici"
 * have to collapse to the same key. If they do not, every transaction looks like
 * a new merchant: categorisation never learns from a correction, recurring
 * payments are never detected, and "re-categorise everything from this merchant"
 * silently does nothing.
 *
 * The stripping is aggressive but bounded — rails, references, bank handles,
 * branch cities, legal suffixes — and capped at three tokens. It is deliberately
 * not fuzzy matching: two genuinely different merchants must not merge, so
 * nothing here matches on edit distance or prefixes.
 */
export function normalizeMerchant(description: string): string {
  let text = description.toLowerCase();

  for (const pattern of REFERENCE_NOISE) {
    text = text.replace(pattern, " ");
  }

  text = text
    .replace(/[^a-z0-9&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = text
    .split(" ")
    .filter(
      (w) =>
        w.length > 1 &&
        !RAIL_WORDS.has(w) &&
        !FILLER_WORDS.has(w) &&
        !CITY_WORDS.has(w) &&
        !HANDLE_PATTERN.test(w),
    );

  const key = words.slice(0, 3).join(" ");
  if (key) return key;

  // Nothing survived — a narration that was pure reference data. Fall back to a
  // sanitised form of the original so the row still groups with its own repeats
  // instead of collapsing into one giant empty-key bucket.
  return (
    description
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 24) || "unknown"
  );
}

/** Stable fingerprint used to reject re-imported rows. */
export function transactionHash(
  date: ISODate,
  amount: number,
  merchant: string,
): string {
  const key = `${date}|${amount.toFixed(2)}|${merchant}`;
  // FNV-1a: short, dependency-free, and collision-safe enough for a dedupe key
  // scoped to one person's statements.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${key.length.toString(36)}-${date}`;
}
