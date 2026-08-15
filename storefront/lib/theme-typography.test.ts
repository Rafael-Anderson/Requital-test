import { describe, expect, it } from "vitest";
import { resolveLetterSpacing, resolveLineHeight } from "./theme-typography";

describe("resolveLineHeight", () => {
  it("maps each named preset to a distinct real value", () => {
    expect(resolveLineHeight("tight")).toBe(1.1);
    expect(resolveLineHeight("normal")).toBe(1.4);
    expect(resolveLineHeight("loose")).toBe(1.7);
  });

  it("defaults to 'normal' when the value is undefined", () => {
    expect(resolveLineHeight(undefined)).toBe(resolveLineHeight("normal"));
  });
});

describe("resolveLetterSpacing", () => {
  it("maps each named preset to a distinct real CSS value", () => {
    expect(resolveLetterSpacing("tight")).toBe("-0.02em");
    expect(resolveLetterSpacing("normal")).toBe("0");
    expect(resolveLetterSpacing("wide")).toBe("0.04em");
  });

  it("defaults to 'normal' when the value is undefined", () => {
    expect(resolveLetterSpacing(undefined)).toBe(resolveLetterSpacing("normal"));
  });
});
