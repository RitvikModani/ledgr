import { describe, expect, it } from "vitest";
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
  percentChange,
} from "./currency";
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  fiscalYearLabel,
  fiscalYearMonths,
  fiscalYearOf,
  fiscalYearRange,
  formatMonthKey,
  isISODate,
  monthKeyOf,
  monthProgress,
  monthRange,
  monthsBetween,
  parseISODate,
  relativeDayLabel,
  toISODate,
} from "./date";

describe("formatCurrency", () => {
  it("groups rupees the Indian way, not the western way", () => {
    // The whole point of routing through Intl: 15,00,000 and not 1,500,000.
    expect(formatCurrency(1_500_000)).toBe("₹15,00,000");
    expect(formatCurrency(100_000)).toBe("₹1,00,000");
    expect(formatCurrency(1_000)).toBe("₹1,000");
  });

  it("groups other currencies by their own locale", () => {
    expect(formatCurrency(1_500_000, { currency: "USD" })).toBe("$1,500,000");
  });

  it("hides paise by default and shows them on request", () => {
    expect(formatCurrency(1234.56)).toBe("₹1,235");
    expect(formatCurrency(1234.56, { decimals: true })).toBe("₹1,234.56");
  });

  it("renders negatives and optional explicit plus signs", () => {
    expect(formatCurrency(-5000)).toBe("-₹5,000");
    expect(formatCurrency(5000, { signed: true })).toBe("+₹5,000");
    expect(formatCurrency(0, { signed: true })).toBe("₹0");
  });

  it("returns an em dash rather than NaN", () => {
    expect(formatCurrency(Number.NaN)).toBe("—");
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatCompactCurrency", () => {
  it("uses lakh and crore for INR", () => {
    expect(formatCompactCurrency(1_50_000)).toBe("₹1.5L");
    expect(formatCompactCurrency(15_00_000)).toBe("₹15L");
    expect(formatCompactCurrency(1_00_00_000)).toBe("₹1Cr");
    expect(formatCompactCurrency(2_45_00_000)).toBe("₹2.45Cr");
  });

  it("uses K/M/B elsewhere", () => {
    expect(formatCompactCurrency(1_500_000, { currency: "USD" })).toBe("$1.5M");
    expect(formatCompactCurrency(2_500_000_000, { currency: "USD" })).toBe("$2.5B");
  });

  it("keeps small values whole", () => {
    expect(formatCompactCurrency(950)).toBe("₹950");
    expect(formatCompactCurrency(0)).toBe("₹0");
  });

  it("loses precision as magnitude grows so the width stays stable", () => {
    expect(formatCompactCurrency(1_250)).toBe("₹1.25K");
    expect(formatCompactCurrency(12_500)).toBe("₹12.5K");
    expect(formatCompactCurrency(125_000)).toBe("₹1.25L");
  });

  it("keeps the sign outside the symbol", () => {
    expect(formatCompactCurrency(-1_50_000)).toBe("-₹1.5L");
    expect(formatCompactCurrency(1_50_000, { signed: true })).toBe("+₹1.5L");
  });
});

describe("formatNumber and formatPercent", () => {
  it("groups bare numbers by locale", () => {
    expect(formatNumber(1_500_000)).toBe("15,00,000");
  });

  it("formats fractions as percentages", () => {
    expect(formatPercent(0.2345)).toBe("23.5%");
    expect(formatPercent(0.2345, 0)).toBe("23%");
  });
});

describe("percentChange", () => {
  it("computes change against the previous magnitude", () => {
    expect(percentChange(120, 100)).toBeCloseTo(0.2);
    expect(percentChange(80, 100)).toBeCloseTo(-0.2);
  });

  it("uses the absolute baseline so a shrinking loss reads as improvement", () => {
    expect(percentChange(-50, -100)).toBeCloseTo(0.5);
  });

  it("refuses to divide by a zero baseline instead of reporting Infinity", () => {
    expect(percentChange(500, 0)).toBeNull();
  });
});

describe("ISO date handling", () => {
  it("validates the shape and the calendar", () => {
    expect(isISODate("2026-04-01")).toBe(true);
    expect(isISODate("2026-4-1")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate(20260401)).toBe(false);
  });

  it("round-trips through local midnight without sliding a day", () => {
    const iso = "2026-03-31";
    expect(toISODate(parseISODate(iso))).toBe(iso);
    expect(parseISODate(iso).getDate()).toBe(31);
    expect(parseISODate(iso).getMonth()).toBe(2);
  });

  it("extracts and formats month keys", () => {
    expect(monthKeyOf("2026-04-15")).toBe("2026-04");
    expect(formatMonthKey("2026-04")).toBe("Apr 2026");
    expect(formatMonthKey("2026-04", true)).toBe("Apr '26");
  });
});

describe("date arithmetic", () => {
  it("adds months across year boundaries in both directions", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-02", -3)).toBe("2025-11");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts months and days between points", () => {
    expect(monthsBetween("2026-01", "2026-04")).toBe(3);
    expect(monthsBetween("2026-04", "2026-01")).toBe(-3);
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });

  it("builds inclusive month ranges and rejects reversed ones", () => {
    expect(monthRange("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
    expect(monthRange("2026-04", "2026-01")).toEqual([]);
  });

  it("knows month lengths including leap Februarys", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-04")).toBe(30);
  });
});

describe("Indian fiscal year", () => {
  it("starts in April, so Jan-Mar belongs to the previous fiscal year", () => {
    expect(fiscalYearOf("2026-04-01")).toBe(2026);
    expect(fiscalYearOf("2026-12-31")).toBe(2026);
    expect(fiscalYearOf("2026-03-31")).toBe(2025);
    expect(fiscalYearOf("2026-01-15")).toBe(2025);
  });

  it("labels and bounds the fiscal year", () => {
    expect(fiscalYearLabel(2026)).toBe("FY 2026–27");
    expect(fiscalYearRange(2026)).toEqual({ start: "2026-04-01", end: "2027-03-31" });
  });

  it("orders fiscal months April first and March last", () => {
    const months = fiscalYearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-04");
    expect(months[11]).toBe("2027-03");
  });
});

describe("monthProgress", () => {
  it("reports the fraction of the month elapsed", () => {
    expect(monthProgress("2026-04-15")).toBeCloseTo(0.5);
    expect(monthProgress("2026-04-30")).toBe(1);
  });

  it("never returns zero, so pace projections cannot divide by it", () => {
    // On the 1st a naive d/total of 0 would project infinite spend and fire
    // every overspend alert at once.
    expect(monthProgress("2026-04-01")).toBeGreaterThan(0);
    expect(monthProgress("2026-04-01")).toBeCloseTo(1 / 30);
  });
});

describe("relativeDayLabel", () => {
  it("names nearby days and counts distant ones", () => {
    expect(relativeDayLabel("2026-04-10", "2026-04-10")).toBe("today");
    expect(relativeDayLabel("2026-04-11", "2026-04-10")).toBe("tomorrow");
    expect(relativeDayLabel("2026-04-09", "2026-04-10")).toBe("yesterday");
    expect(relativeDayLabel("2026-04-17", "2026-04-10")).toBe("in 7 days");
    expect(relativeDayLabel("2026-04-03", "2026-04-10")).toBe("7 days ago");
  });
});
