import { describe, expect, it } from "vitest";
import { getReadableTextColor } from "./color-contrast";

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
