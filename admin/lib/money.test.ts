import { describe, expect, it } from "vitest";
import { currencyDecimals, formatAmount, formatMoney } from "./money";

describe("currencyDecimals", () => {
  it("is 3 for the Gulf three-decimal currencies", () => {
    for (const c of ["KWD", "BHD", "OMR"]) expect(currencyDecimals(c)).toBe(3);
  });
  it("is 2 for the rest, and for anything unrecognised", () => {
    for (const c of ["AED", "SAR", "QAR", "USD", "XYZ"]) {
      expect(currencyDecimals(c)).toBe(2);
    }
    expect(currencyDecimals(null)).toBe(2);
  });
});

describe("formatMoney", () => {
  it("renders the code, not a symbol", () => {
    expect(formatMoney(199, "AED")).toBe("199.00 AED");
  });

  it("uses the currency's own decimal width", () => {
    // The bug this replaces: every admin site hardcoded 2 decimals, so a KWD
    // amount was rendered as a different number than it actually was.
    expect(formatMoney(10.5, "KWD")).toBe("10.500 KWD");
    expect(formatMoney(10.5, "AED")).toBe("10.50 AED");
  });

  it("accepts the DECIMAL strings the API returns", () => {
    expect(formatMoney("199.000000000000000000000000000000", "AED")).toBe(
      "199.00 AED",
    );
  });

  it("never renders NaN or null into the dashboard", () => {
    expect(formatMoney(null, "AED")).toBe("AED");
    expect(formatMoney(undefined, "AED")).toBe("AED");
    expect(formatMoney("oops", "AED")).toBe("AED");
  });

  it("degrades to a bare amount when no currency is known yet", () => {
    // Pages render before the shop has loaded; a dangling space would shift the
    // column.
    expect(formatMoney(199, null)).toBe("199.00");
  });
});

describe("formatAmount", () => {
  it("omits the code for callers that render it separately", () => {
    expect(formatAmount(10.5, "KWD")).toBe("10.500");
    expect(formatAmount(10.5, "AED")).toBe("10.50");
  });
  it("is empty rather than NaN for a missing value", () => {
    expect(formatAmount(null, "AED")).toBe("");
  });
});

describe("formatMoney thousands separators", () => {
  it("keeps separators, which SimpleDashboard's toLocaleString() already had", () => {
    // Every other admin site used toFixed() and had none, so unifying on
    // separators avoids regressing the one card that did.
    expect(formatMoney(1234.5, "AED")).toBe("1,234.50 AED");
    expect(formatMoney(1234567, "AED")).toBe("1,234,567.00 AED");
  });

  it("combines separators with the currency's own decimal width", () => {
    expect(formatMoney(1234.5, "KWD")).toBe("1,234.500 KWD");
  });

  it("is locale-pinned, so CI and a non-en machine agree", () => {
    // A runtime defaulting to de-DE would otherwise render "1.234,50".
    expect(formatMoney(1234.5, "AED")).toContain(",");
    expect(formatMoney(1234.5, "AED")).toContain(".50");
  });
});
