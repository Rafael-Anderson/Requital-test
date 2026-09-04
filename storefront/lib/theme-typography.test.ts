import { describe, expect, it } from "vitest";
import {
  resolveLetterSpacing,
  resolveLineHeight,
  resolveScaleSizes,
  resolveTypographyPairing,
} from "./theme-typography";

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

describe("resolveTypographyPairing (Phase B1)", () => {
  it("returns null for unset / unknown ⇒ per-role font reads run as today", () => {
    expect(resolveTypographyPairing(undefined)).toBeNull();
    expect(resolveTypographyPairing(null)).toBeNull();
    expect(resolveTypographyPairing("not-a-pairing")).toBeNull();
  });
  it("resolves a bundle to its 4 role fonts", () => {
    expect(resolveTypographyPairing("editorial-serif")).toEqual({
      headingFont: "Fraunces",
      bodyFont: "Inter",
      accentFont: "Fraunces",
      subheadingFont: "Inter",
    });
    expect(resolveTypographyPairing("handwritten-accent")?.accentFont).toBe("Caveat");
  });
});

describe("resolveScaleSizes (Phase B1)", () => {
  it("returns null for unset / unknown ⇒ applyHeadingPreset keeps using each preset's own size", () => {
    expect(resolveScaleSizes(undefined)).toBeNull();
    expect(resolveScaleSizes(null)).toBeNull();
    expect(resolveScaleSizes("huge")).toBeNull();
  });
  it("returns a full h1–h6 px table per scale", () => {
    expect(resolveScaleSizes("dramatic")).toEqual({ h1: 64, h2: 46, h3: 34, h4: 25, h5: 20, h6: 16 });
    expect(resolveScaleSizes("compact")?.h1).toBe(40);
  });
  it("'default' ≈ DEFAULT_THEME_CONFIG's seed sizes (48/36/28/22/18/16)", () => {
    expect(resolveScaleSizes("default")).toEqual({ h1: 48, h2: 36, h3: 28, h4: 22, h5: 18, h6: 16 });
  });
});
