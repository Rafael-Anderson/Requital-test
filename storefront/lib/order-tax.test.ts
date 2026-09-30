import { describe, expect, it } from "vitest";
import { quoteCartTax } from "./order-tax";

const line = (amount: number, taxRate?: number) => ({ amount, taxRate });

describe("quoteCartTax", () => {
  // The case the whole per-line change exists for: quoting one shop rate over
  // the basket would tax the zero-rated item the server will not charge for.
  it("taxes each line at its own rate", () => {
    const { taxAmount, estimated } = quoteCartTax({
      lines: [line(100, 5), line(100, 0)],
      taxInclusive: false,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(estimated).toBe(false);
  });

  it("backs the tax out on an inclusive shop instead of adding it", () => {
    const { taxAmount } = quoteCartTax({
      lines: [line(105, 5)],
      taxInclusive: true,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
  });

  it("apportions a discount pro rata, so tax follows what is actually paid", () => {
    const { taxAmount } = quoteCartTax({
      lines: [line(100, 5), line(300, 5)],
      discountAmount: 40,
      taxInclusive: false,
    });
    // 5% of 360, not of 400.
    expect(taxAmount).toBeCloseTo(18, 6);
  });

  it("only the taxed line's share of a discount reduces the tax", () => {
    const { taxAmount } = quoteCartTax({
      lines: [line(100, 5), line(100, 0)],
      discountAmount: 50,
      taxInclusive: false,
    });
    // 25 off each line; only the 5% line owes anything: 5% of 75.
    expect(taxAmount).toBeCloseTo(3.75, 6);
  });

  it("a discount bigger than the basket cannot produce negative tax", () => {
    expect(
      quoteCartTax({
        lines: [line(100, 5)],
        discountAmount: 500,
        taxInclusive: false,
      }).taxAmount,
    ).toBe(0);
  });

  it("survives an empty or zero-value basket", () => {
    expect(quoteCartTax({ lines: [], taxInclusive: false }).taxAmount).toBe(0);
    const zero = quoteCartTax({
      lines: [line(0, 5)],
      discountAmount: 10,
      taxInclusive: false,
    });
    expect(zero.taxAmount).toBe(0);
    expect(Number.isNaN(zero.taxAmount)).toBe(false);
  });

  // A cart saved in localStorage before per-line rates shipped has no rate on
  // its lines. The shop's standard rate is the best estimate available, and the
  // flag is what stops the UI presenting a guess as a fact.
  it("falls back to the shop rate for an unknown line and flags it estimated", () => {
    const { taxAmount, estimated } = quoteCartTax({
      lines: [line(100, undefined)],
      taxInclusive: false,
      fallbackRate: 5,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(estimated).toBe(true);
  });

  it("flags estimated when only SOME lines are unknown", () => {
    const { taxAmount, estimated } = quoteCartTax({
      lines: [line(100, 0), line(100, undefined)],
      taxInclusive: false,
      fallbackRate: 5,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(estimated).toBe(true);
  });

  // A shop that charges no tax should not get a "Tax 0.00" row.
  it("reports empty for a shop with no tax at all", () => {
    expect(
      quoteCartTax({ lines: [line(100, undefined)], taxInclusive: false })
        .empty,
    ).toBe(true);
  });

  it("is NOT empty when a real 0% class was resolved", () => {
    // Zero-rated is a deliberate treatment, not an absent one - the row still
    // belongs on a document that shows tax.
    const quote = quoteCartTax({
      lines: [line(100, 0)],
      taxInclusive: false,
    });
    expect(quote.taxAmount).toBe(0);
    expect(quote.empty).toBe(false);
  });
});
