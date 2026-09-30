import { describe, expect, it } from "vitest";
import { hasAmount } from "./order-money-rows";

describe("hasAmount", () => {
  // The whole reason this exists: the two order-detail pages had two different
  // guards, and BOTH showed a Tax row on a zero-tax order. The account page used
  // truthiness, which on a string is true for "0.00".
  it("is false for a zero, however it is spelled", () => {
    expect(hasAmount("0.00")).toBe(false);
    expect(hasAmount("0.000000000000000000000000000000")).toBe(false);
    expect(hasAmount(0)).toBe(false);
    expect(hasAmount("0")).toBe(false);
  });

  it("is false for a value that was never recorded", () => {
    expect(hasAmount(null)).toBe(false);
    expect(hasAmount(undefined)).toBe(false);
  });

  it("is true for a real amount, as a string or a number", () => {
    expect(hasAmount("5.00")).toBe(true);
    expect(hasAmount(5)).toBe(true);
    expect(hasAmount("0.001")).toBe(true);
  });

  it("is false for junk rather than throwing", () => {
    expect(hasAmount("")).toBe(false);
    expect(hasAmount("not a number")).toBe(false);
  });
});
