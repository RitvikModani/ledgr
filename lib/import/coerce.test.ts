import { describe, expect, it } from "vitest";
import {
  detectDateOrder,
  normalizeMerchant,
  parseAmount,
  parseDate,
  transactionHash,
} from "./coerce";

describe("parseAmount", () => {
  it("reads Indian grouping and currency noise", () => {
    expect(parseAmount("1,50,000.00")).toBe(150000);
    expect(parseAmount("₹1,50,000")).toBe(150000);
    expect(parseAmount("Rs. 2,499.50")).toBe(2499.5);
    expect(parseAmount("INR 1,234")).toBe(1234);
  });

  it("reads accounting negatives", () => {
    expect(parseAmount("(1,234)")).toBe(-1234);
    expect(parseAmount("(₹1,234.50)")).toBe(-1234.5);
  });

  it("treats Dr as a debit and Cr as a credit", () => {
    expect(parseAmount("1,234.00 Dr")).toBe(-1234);
    expect(parseAmount("1,234.00 Cr")).toBe(1234);
    expect(parseAmount("DR 5000")).toBe(-5000);
  });

  it("reads leading and trailing minus signs", () => {
    expect(parseAmount("-4,500")).toBe(-4500);
    expect(parseAmount("4,500-")).toBe(-4500);
    expect(parseAmount("+4,500")).toBe(4500);
  });

  it("resolves grouping vs decimal by position", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56); // European decimal comma
    expect(parseAmount("1,234.56")).toBe(1234.56); // western grouping
    expect(parseAmount("1,234")).toBe(1234); // grouping, not a decimal
    expect(parseAmount("1,23,456.78")).toBe(123456.78); // Indian grouping
  });

  it("passes numbers through untouched", () => {
    expect(parseAmount(1234.56)).toBe(1234.56);
    expect(parseAmount(-99)).toBe(-99);
    expect(parseAmount(0)).toBe(0);
  });

  it("returns null for junk rather than a misleading zero", () => {
    // A zero here would become a real transaction and drag every average down.
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
    expect(parseAmount("Opening Balance")).toBeNull();
    expect(parseAmount("--")).toBeNull();
    expect(parseAmount(new Date())).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads ISO without consulting the column order", () => {
    expect(parseDate("2026-04-01")).toBe("2026-04-01");
    expect(parseDate("2026-04-01", "month-first")).toBe("2026-04-01");
  });

  it("reads day-first and month-first numeric dates as instructed", () => {
    expect(parseDate("05/04/2026", "day-first")).toBe("2026-04-05");
    expect(parseDate("05/04/2026", "month-first")).toBe("2026-05-04");
  });

  it("ignores the stated order when a component settles it", () => {
    // 13 cannot be a month, whatever the column usually does.
    expect(parseDate("13/04/2026", "month-first")).toBe("2026-04-13");
    expect(parseDate("04/13/2026", "day-first")).toBe("2026-04-13");
  });

  it("accepts assorted separators and named months", () => {
    expect(parseDate("05-04-2026")).toBe("2026-04-05");
    expect(parseDate("05.04.2026")).toBe("2026-04-05");
    expect(parseDate("01-Apr-2026")).toBe("2026-04-01");
    expect(parseDate("1 April 2026")).toBe("2026-04-01");
    expect(parseDate("Apr 1, 2026")).toBe("2026-04-01");
  });

  it("expands two-digit years around 1970", () => {
    expect(parseDate("01/04/26")).toBe("2026-04-01");
    expect(parseDate("01/04/99")).toBe("1999-04-01");
  });

  it("converts Excel serial numbers", () => {
    // 45383 is 2024-04-01 in Excel's serial calendar.
    expect(parseDate(45383)).toBe("2024-04-01");
  });

  it("passes Date objects through as local calendar days", () => {
    expect(parseDate(new Date(2026, 3, 1))).toBe("2026-04-01");
  });

  it("rejects impossible dates instead of rolling them forward", () => {
    // JS would happily turn 31 February into 3 March.
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("32/01/2026")).toBeNull();
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("detectDateOrder", () => {
  it("uses a day above 12 as proof of day-first", () => {
    expect(detectDateOrder(["05/04/2026", "13/04/2026", "07/04/2026"])).toBe("day-first");
  });

  it("uses a second component above 12 as proof of month-first", () => {
    expect(detectDateOrder(["04/13/2026", "04/05/2026"])).toBe("month-first");
  });

  it("falls back to day-first when nothing disambiguates", () => {
    expect(detectDateOrder(["05/04/2026", "06/04/2026"])).toBe("day-first");
    expect(detectDateOrder([])).toBe("day-first");
  });

  it("goes with the weight of evidence when a column is inconsistent", () => {
    expect(detectDateOrder(["13/04/2026", "14/04/2026", "04/13/2026"])).toBe("day-first");
  });
});

describe("normalizeMerchant", () => {
  it("collapses UPI narrations for the same merchant onto one key", () => {
    const a = normalizeMerchant("UPI/SWIGGY BANGALORE/428193847/OKHDFCBANK");
    const b = normalizeMerchant("UPI-SWIGGY-9928374-@okicici");
    expect(a).toBe(b);
    expect(a).toContain("swiggy");
  });

  it("strips transfer rails, reference numbers and legal suffixes", () => {
    expect(normalizeMerchant("NEFT DR-HDFC0001234-RELIANCE RETAIL PVT LTD")).toContain(
      "reliance",
    );
    expect(normalizeMerchant("IMPS/P2A/412345678901/RENT")).toBe("rent");
  });

  it("is stable across casing and punctuation", () => {
    expect(normalizeMerchant("Amazon.in  Payments")).toBe(
      normalizeMerchant("AMAZON IN PAYMENTS"),
    );
  });

  it("never returns an empty key for a non-empty narration", () => {
    expect(normalizeMerchant("12345678")).not.toBe("");
  });
});

describe("transactionHash", () => {
  it("is stable for identical rows", () => {
    expect(transactionHash("2026-04-01", -450, "swiggy")).toBe(
      transactionHash("2026-04-01", -450, "swiggy"),
    );
  });

  it("separates rows that differ in any component", () => {
    const base = transactionHash("2026-04-01", -450, "swiggy");
    expect(transactionHash("2026-04-02", -450, "swiggy")).not.toBe(base);
    expect(transactionHash("2026-04-01", -451, "swiggy")).not.toBe(base);
    expect(transactionHash("2026-04-01", -450, "zomato")).not.toBe(base);
  });

  it("treats -450 and 450 as different transactions", () => {
    expect(transactionHash("2026-04-01", 450, "swiggy")).not.toBe(
      transactionHash("2026-04-01", -450, "swiggy"),
    );
  });
});
