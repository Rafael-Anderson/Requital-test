import { describe, expect, it } from "vitest";
import { currencyDecimals, currencySymbol, formatPriceAmount } from "./currency";

describe("currencyDecimals", () => {
  it("is 3 for the Gulf three-decimal currencies", () => {
    for (const c of ["KWD", "BHD", "OMR"]) expect(currencyDecimals(c)).toBe(3);
  });
  it("is 2 otherwise, including for an unknown code", () => {
    for (const c of ["AED", "SAR", "QAR", "USD", "XYZ"]) {
      expect(currencyDecimals(c)).toBe(2);
    }
    expect(currencyDecimals(null)).toBe(2);
  });
});

describe("formatPriceAmount", () => {
  it("renders the currency's own decimal width", () => {
    // The bug this replaces: every checkout total hardcoded .toFixed(2), so a
    // KWD price was rendered as a different amount, not just a restyled one.
    expect(formatPriceAmount(10.5, "KWD")).toBe("10.500");
    expect(formatPriceAmount(10.5, "AED")).toBe("10.50");
  });

  it("omits any code or symbol — <CurrencySymbol> renders that alongside", () => {
    expect(formatPriceAmount(10.5, "AED")).not.toContain("AED");
    expect(formatPriceAmount(10.5, "AED")).not.toContain("د");
  });

  it("is empty rather than NaN for a missing value", () => {
    expect(formatPriceAmount(null, "AED")).toBe("");
    expect(formatPriceAmount(undefined, "AED")).toBe("");
    expect(formatPriceAmount("oops", "AED")).toBe("");
  });

  it("accepts the DECIMAL strings the API returns", () => {
    expect(formatPriceAmount("199.000000000000000000000000000000", "AED")).toBe(
      "199.00",
    );
  });
});

describe("currencySymbol", () => {
  it("falls back to the ISO code, which is why the map stays at one entry", () => {
    // Deliberate: see lib/currency.ts's note. "1234.500 KWD" always renders;
    // a questionable Arabic-script glyph does not.
    expect(currencySymbol("KWD")).toBe("KWD");
    expect(currencySymbol("SAR")).toBe("SAR");
    expect(currencySymbol(null)).toBe("");
  });
});
