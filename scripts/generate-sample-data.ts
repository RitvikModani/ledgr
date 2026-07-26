import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

/**
 * Generates the sample and template spreadsheets shipped in /public.
 *
 * The sample is deliberately not clean. It has a bank-style title block above
 * the header, separate withdrawal and deposit columns, Indian number grouping,
 * DD/MM dates, transfers between two accounts, a subscription that goes up in
 * price mid-year, a duplicated charge and one outlier — so loading it actually
 * exercises the importer and fires several alert rules, rather than
 * demonstrating a happy path that never occurs in the wild.
 *
 * Seeded RNG so regenerating produces the same file and the diff stays readable.
 */

let seed = 20260725;
function random(): number {
  // Mulberry32.
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function between(min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

const GROCERS = ["BIGBASKET", "DMART", "BLINKIT", "ZEPTO", "RELIANCE FRESH"];
const FOOD = ["SWIGGY", "ZOMATO", "THIRD WAVE COFFEE", "BURGER KING", "HALDIRAM"];
const TRANSPORT = ["UBER", "OLA", "RAPIDO", "NAMMA YATRI", "BMTC"];
const SHOPS = ["AMAZON", "FLIPKART", "MYNTRA", "CROMA", "DECATHLON"];
const FUEL = ["HP PETROL PUMP", "INDIAN OIL", "SHELL"];

interface Row {
  date: Date;
  narration: string;
  ref: string;
  withdrawal: number | null;
  deposit: number | null;
}

function ddmmyyyy(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${date.getFullYear()}`;
}

/** Indian digit grouping, written as text so the importer has to parse it. */
function inr(value: number): string {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function upi(merchant: string): string {
  return `UPI/${merchant}/${between(100000000, 999999999)}/OKHDFCBANK`;
}

function buildTransactions(): Row[] {
  const rows: Row[] = [];
  const start = new Date(2025, 6, 1); // July 2025

  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const year = start.getFullYear() + Math.floor((start.getMonth() + monthIndex) / 12);
    const month = (start.getMonth() + monthIndex) % 12;
    const day = (d: number) => new Date(year, month, d);

    // Salary, with an increment part-way through the year.
    const salary = monthIndex < 7 ? 168000 : 186000;
    rows.push({
      date: day(1),
      narration: "SALARY CREDIT NEOWORKS TECHNOLOGIES",
      ref: `SAL${year}${String(month + 1).padStart(2, "0")}`,
      withdrawal: null,
      deposit: salary,
    });

    rows.push({
      date: day(3),
      narration: "NEFT DR-HDFC0000123-RENT PAYMENT LANDLORD",
      ref: `N${between(100000, 999999)}`,
      withdrawal: 34000,
      deposit: null,
    });

    // A self-transfer to the investment account, both legs, so transfer
    // detection has something real to pair.
    rows.push({
      date: day(4),
      narration: "IMPS/P2A/TRANSFER TO OWN ACCOUNT ICICI",
      ref: `IM${between(100000, 999999)}`,
      withdrawal: 25000,
      deposit: null,
    });

    rows.push({
      date: day(5),
      narration: "SIP MIRAE ASSET LARGE CAP FUND",
      ref: `SIP${between(10000, 99999)}`,
      withdrawal: 15000,
      deposit: null,
    });

    rows.push({
      date: day(5),
      narration: "HDFC HOME LOAN EMI",
      ref: `EMI${between(10000, 99999)}`,
      withdrawal: 22400,
      deposit: null,
    });

    // Netflix, which raises its price in month 8.
    rows.push({
      date: day(6),
      narration: upi("NETFLIX"),
      ref: "0000",
      withdrawal: monthIndex < 8 ? 649 : 799,
      deposit: null,
    });

    rows.push({
      date: day(7),
      narration: upi("AIRTEL POSTPAID"),
      ref: "0000",
      withdrawal: 999,
      deposit: null,
    });

    rows.push({
      date: day(9),
      narration: "BESCOM ELECTRICITY BILL",
      ref: `BE${between(10000, 99999)}`,
      withdrawal: between(1400, 3600),
      deposit: null,
    });

    rows.push({
      date: day(11),
      narration: upi("STAR HEALTH INSURANCE PREMIUM"),
      ref: "0000",
      withdrawal: 2450,
      deposit: null,
    });

    // Everyday spending.
    for (let i = 0; i < 4; i++) {
      rows.push({
        date: day(between(2, 27)),
        narration: upi(pick(GROCERS)),
        ref: "0000",
        withdrawal: between(900, 3200),
        deposit: null,
      });
    }

    for (let i = 0; i < 7; i++) {
      rows.push({
        date: day(between(2, 28)),
        narration: upi(pick(FOOD)),
        ref: "0000",
        withdrawal: between(180, 1400),
        deposit: null,
      });
    }

    for (let i = 0; i < 5; i++) {
      rows.push({
        date: day(between(2, 28)),
        narration: upi(pick(TRANSPORT)),
        ref: "0000",
        withdrawal: between(90, 640),
        deposit: null,
      });
    }

    rows.push({
      date: day(between(8, 24)),
      narration: `POS ${pick(FUEL)} BANGALORE`,
      ref: `POS${between(100000, 999999)}`,
      withdrawal: between(2200, 4200),
      deposit: null,
    });

    if (random() > 0.35) {
      rows.push({
        date: day(between(4, 26)),
        narration: upi(pick(SHOPS)),
        ref: "0000",
        withdrawal: between(700, 6800),
        deposit: null,
      });
    }

    // The card bill: a self-transfer that would otherwise double-count.
    rows.push({
      date: day(18),
      narration: "CREDIT CARD PAYMENT HDFC AUTOPAY",
      ref: `CC${between(100000, 999999)}`,
      withdrawal: between(9000, 24000),
      deposit: null,
    });
  }

  // A festival splurge — a genuine outlier for its category.
  rows.push({
    date: new Date(2025, 9, 18),
    narration: "UPI/TANISHQ JEWELLERY/882910473/OKHDFCBANK",
    ref: "0000",
    withdrawal: 84000,
    deposit: null,
  });

  // A double charge on consecutive days.
  rows.push({
    date: new Date(2026, 1, 14),
    narration: "UPI/CULT FIT MEMBERSHIP/771029384/OKHDFCBANK",
    ref: "0000",
    withdrawal: 4999,
    deposit: null,
  });
  rows.push({
    date: new Date(2026, 1, 15),
    narration: "UPI/CULT FIT MEMBERSHIP/771029385/OKHDFCBANK",
    ref: "0000",
    withdrawal: 4999,
    deposit: null,
  });

  // A lean month, so the savings-rate and income-drop rules have something real.
  rows.push({
    date: new Date(2026, 4, 22),
    narration: "MEDICAL EMERGENCY APOLLO HOSPITAL",
    ref: `AP${between(100000, 999999)}`,
    withdrawal: 68000,
    deposit: null,
  });

  return rows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function writeSampleStatement(outDir: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ledgr";
  const sheet = workbook.addWorksheet("Account Statement");

  // The title block real bank exports open with, which is exactly why the
  // importer scans for the header rather than assuming row 1.
  sheet.addRow(["HDFC BANK LIMITED"]);
  sheet.addRow(["Statement of account 50100987654321"]);
  sheet.addRow(["Period : 01/07/2025 to 30/06/2026"]);
  sheet.addRow([]);
  sheet.addRow([
    "Date",
    "Narration",
    "Chq/Ref No",
    "Withdrawal Amt.",
    "Deposit Amt.",
    "Closing Balance",
  ]);

  let balance = 240000;
  const rows = buildTransactions();

  for (const row of rows) {
    balance += (row.deposit ?? 0) - (row.withdrawal ?? 0);
    sheet.addRow([
      ddmmyyyy(row.date),
      row.narration,
      row.ref,
      row.withdrawal === null ? "" : inr(row.withdrawal),
      row.deposit === null ? "" : inr(row.deposit),
      inr(balance),
    ]);
  }

  sheet.addRow([]);
  sheet.addRow(["TOTAL", "", "", "", "", inr(balance)]);

  sheet.columns = [
    { width: 12 },
    { width: 46 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  const holdings = workbook.addWorksheet("Holdings");
  holdings.addRow(["Portfolio summary as on 25/07/2026"]);
  holdings.addRow([]);
  holdings.addRow(["Scheme Name", "Category", "Units", "Avg NAV", "Current Value", "Invested On"]);

  for (const row of [
    ["UTI Nifty 50 Index Fund", "Equity", 4820.44, 128.4, "7,45,000.00", "12/05/2023"],
    ["Mirae Asset Large Cap Fund", "Equity", 3120.1, 92.6, "3,88,000.00", "08/09/2022"],
    ["Motilal Oswal Nasdaq 100 FoF", "Equity", 6400.0, 28.9, "2,42,000.00", "19/01/2024"],
    ["HDFC Corporate Bond Fund", "Debt", 4200.0, 26.1, "1,26,500.00", "08/01/2024"],
    ["Public Provident Fund", "Debt", "", "", "9,80,000.00", "01/04/2019"],
    ["EPF Accumulation", "Debt", "", "", "14,20,000.00", "01/07/2018"],
    ["Sovereign Gold Bond 2031", "Gold", 60, 5400, "4,10,000.00", "15/09/2022"],
    ["HDFC Liquid Fund", "Cash", 1800.0, 46.2, "88,000.00", "03/03/2026"],
  ]) {
    holdings.addRow(row);
  }

  holdings.columns = [
    { width: 34 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
  ];

  const file = path.join(outDir, "ledgr-sample-data.xlsx");
  await workbook.xlsx.writeFile(file);
  return { file, rows: rows.length };
}

/** A clean template for anyone who would rather start from a known-good shape. */
async function writeTemplate(outDir: string) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ledgr";

  const sheet = workbook.addWorksheet("Transactions");
  sheet.addRow(["Date", "Description", "Amount", "Category", "Account"]);
  sheet.addRow(["01/04/2026", "Salary", 120000, "Income", "Main"]);
  sheet.addRow(["03/04/2026", "Rent", -34000, "Rent", "Main"]);
  sheet.addRow(["05/04/2026", "Groceries — BigBasket", -2400, "Groceries", "Main"]);
  sheet.addRow(["06/04/2026", "Netflix", -799, "Subscriptions", "Main"]);
  sheet.columns = [{ width: 12 }, { width: 34 }, { width: 12 }, { width: 16 }, { width: 12 }];

  const notes = workbook.addWorksheet("How to use this");
  for (const line of [
    ["Dates can be DD/MM/YYYY or YYYY-MM-DD. Ledgr works out which from the whole column."],
    ["Amount: negative for money out, positive for money in."],
    ["If your bank gives separate Debit and Credit columns, keep them — Ledgr reads those too."],
    ["Category and Account are optional. Ledgr will categorise from the description if you leave Category out."],
    ["Amounts may be written as 1,50,000.00, (1,234), or 1,234.00 Dr — all are understood."],
    ["Re-importing a file you have already imported adds only the rows that are new."],
  ]) {
    notes.addRow(line);
  }
  notes.columns = [{ width: 110 }];

  const holdings = workbook.addWorksheet("Holdings");
  holdings.addRow(["Scheme Name", "Category", "Units", "Avg Cost", "Current Value", "Invested On"]);
  holdings.addRow(["UTI Nifty 50 Index Fund", "Equity", 1200, 128.4, 245000, "12/05/2023"]);
  holdings.addRow(["Public Provident Fund", "Debt", "", "", 850000, "01/04/2019"]);
  holdings.columns = [
    { width: 34 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
  ];

  const file = path.join(outDir, "ledgr-import-template.xlsx");
  await workbook.xlsx.writeFile(file);
  return file;
}

async function main() {
  const outDir = path.join(process.cwd(), "public");
  await mkdir(outDir, { recursive: true });

  const sample = await writeSampleStatement(outDir);
  const template = await writeTemplate(outDir);

  // A tiny CSV too, so the delimited path has a fixture as well.
  const csv = [
    "Date,Description,Amount,Category",
    "01/04/2026,Salary,120000,Income",
    "03/04/2026,Rent,-34000,Rent",
    '05/04/2026,"Groceries, BigBasket",-2400,Groceries',
  ].join("\n");
  await writeFile(path.join(outDir, "ledgr-sample-data.csv"), csv, "utf8");

  console.log(`Wrote ${sample.file} (${sample.rows} transactions)`);
  console.log(`Wrote ${template}`);
  console.log(`Wrote ${path.join(outDir, "ledgr-sample-data.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
