import { describe, expect, it } from "vitest";
import { getReadableTextColor, bestContrastRatio, getContrastWarning } from "./color-contrast";

describe("getReadableTextColor", () => {
  it("prefers white on Requital's own default teal (the pre-ship bug: naive max-contrast picks black here)", () => {
    expect(getReadableTextColor("#069494")).toBe("#ffffff");
  });

  it("falls back to near-black on near-white/light colors, where white genuinely fails", () => {
    expect(getReadableTextColor("#ffffff")).toBe("#0a0a0a");
    expect(getReadableTextColor("#f5f5f5")).toBe("#0a0a0a");
  });

  it("falls back to near-black on bright, low-contrast colors like yellow", () => {
    expect(getReadableTextColor("#ffff00")).toBe("#0a0a0a");
  });

  it("picks white on dark colors", () => {
    expect(getReadableTextColor("#000000")).toBe("#ffffff");
    expect(getReadableTextColor("#111827")).toBe("#ffffff");
  });

  it("defaults to white for missing/invalid input", () => {
    expect(getReadableTextColor(null)).toBe("#ffffff");
    expect(getReadableTextColor(undefined)).toBe("#ffffff");
    expect(getReadableTextColor("not-a-color")).toBe("#ffffff");
  });
});

describe("bestContrastRatio", () => {
  it("returns null for invalid input", () => {
    expect(bestContrastRatio(null)).toBeNull();
    expect(bestContrastRatio("nope")).toBeNull();
  });

  it("returns the best achievable ratio", () => {
    expect(bestContrastRatio("#000000")).toBeCloseTo(21, 0);
  });
});

describe("getContrastWarning", () => {
  // Regression test for a real bug this test file caught: the best
  // achievable contrast of {white, black} against ANY hex color is
  // mathematically >= ~4.58:1 (the two contrast curves cross there), so a
  // warning threshold of 4.5 (WCAG AA normal text) could never fire for any
  // input — dead code. Only a stricter bar (AAA, 7:1) can ever trigger.
  it("warns on a borderline-contrast color like Requital's own teal", () => {
    expect(getContrastWarning("#069494")).toMatch(/borderline/);
  });

  it("does not warn on colors with strong best-achievable contrast", () => {
    expect(getContrastWarning("#000000")).toBeNull();
    expect(getContrastWarning("#ffffff")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(getContrastWarning("nope")).toBeNull();
  });
});
