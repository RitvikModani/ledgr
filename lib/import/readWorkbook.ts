import Papa from "papaparse";
import type { RawRow, RawSheet } from "./detect";

export const ACCEPTED_EXTENSIONS = [".xlsx", ".xlsm", ".csv", ".tsv"] as const;

/** Refuse anything large enough to lock up the tab before we start parsing it. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class ImportError extends Error {}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/**
 * Reads a spreadsheet into plain rows.
 *
 * Parsing happens in the browser, on the user's own machine — the file is never
 * uploaded. ExcelJS is used rather than the more common `xlsx` package because
 * that package's npm builds carry unpatched prototype-pollution advisories, and
 * this function's whole job is to parse a file Ledgr did not create.
 */
export async function readWorkbook(file: File): Promise<RawSheet[]> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ImportError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Ledgr reads files up to 25 MB.`,
    );
  }

  const extension = extensionOf(file.name);

  if (extension === ".csv" || extension === ".tsv") {
    return [readDelimited(await file.text(), file.name)];
  }

  if (extension === ".xlsx" || extension === ".xlsm") {
    return readExcel(await file.arrayBuffer());
  }

  if (extension === ".xls") {
    throw new ImportError(
      "That is the old .xls format. Open it in Excel or Sheets and save as .xlsx, then try again.",
    );
  }

  throw new ImportError(
    `Ledgr reads ${ACCEPTED_EXTENSIONS.join(", ")} files. It cannot read "${extension || "that file"}".`,
  );
}

function readDelimited(text: string, name: string): RawSheet {
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    // Let Papa work out comma vs semicolon vs tab rather than assuming comma.
    delimiter: "",
  });

  if (parsed.data.length === 0) {
    throw new ImportError("That file has no rows in it.");
  }

  return { name: name.replace(/\.(csv|tsv)$/i, ""), rows: parsed.data as RawRow[] };
}

async function readExcel(buffer: ArrayBuffer): Promise<RawSheet[]> {
  // Dynamically imported so ExcelJS is not in the bundle for anyone who never
  // opens the import page.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new ImportError(
      "That file could not be opened as a spreadsheet. If it was renamed to .xlsx, save it again from Excel or Sheets.",
    );
  }

  const sheets: RawSheet[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: RawRow[] = [];

    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      // ExcelJS returns a 1-based array with a hole at index 0.
      rows.push(values.slice(1).map(toRawCell) as RawRow);
    });

    if (rows.length > 0) sheets.push({ name: worksheet.name, rows });
  });

  if (sheets.length === 0) {
    throw new ImportError("That workbook has no sheets with any rows in them.");
  }

  return sheets;
}

/** Flattens ExcelJS's rich text, hyperlink and formula cell objects to primitives. */
function toRawCell(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value as string | number | boolean;
  }

  const obj = value as {
    text?: unknown;
    result?: unknown;
    richText?: Array<{ text: string }>;
    hyperlink?: string;
    error?: string;
  };

  // A formula that evaluated to an error must not become the string "#DIV/0!"
  // and get parsed as a description.
  if (obj.error) return null;
  if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("");
  if (obj.result !== undefined) return obj.result as string | number;
  if (typeof obj.text === "string") return obj.text;

  return null;
}
