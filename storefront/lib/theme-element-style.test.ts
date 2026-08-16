import { describe, expect, it } from "vitest";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveImageElementStyle,
  resolveNavElementStyle,
  resolvePriceElementStyle,
} from "./theme-element-style";

describe("resolveTextElementStyle", () => {
  it("returns an empty style object when no fields are set", () => {
    expect(resolveTextElementStyle({})).toEqual({});
  });

  it("resolves every field, including the named letterSpacing/lineHeight presets to real CSS values", () => {
    const style = resolveTextElementStyle({
      fontSize: 24,
      fontWeight: "600",
      color: "#ff0000",
      fontFamily: "Poppins",
      letterSpacing: "wide",
      textAlign: "center",
      textTransform: "uppercase",
      lineHeight: "loose",
    });
    expect(style.fontSize).toBe("24px");
    expect(style.fontWeight).toBe("600");
    expect(style.color).toBe("#ff0000");
    expect(style.fontFamily).toContain("Poppins");
    expect(style.letterSpacing).toBe("0.04em"); // "wide"
    expect(style.textAlign).toBe("center");
    expect(style.textTransform).toBe("uppercase");
    expect(style.lineHeight).toBe(1.7); // "loose"
  });

  it("ignores textTransform values other than 'uppercase' (no 'none' in the CSS output)", () => {
    expect(resolveTextElementStyle({ textTransform: "none" })).toEqual({});
  });

  it("ignores fields of the wrong type rather than producing malformed CSS", () => {
    expect(resolveTextElementStyle({ fontSize: "not a number", color: 42 })).toEqual({});
  });
});

describe("resolveButtonElementStyle", () => {
  it("maps background/text/padding fields to real CSS properties", () => {
    const style = resolveButtonElementStyle({
      backgroundColor: "#069494",
      textColor: "#ffffff",
      borderRadius: 8,
      paddingX: 24,
      paddingY: 12,
      fontSize: 14,
    });
    expect(style.background).toBe("#069494");
    expect(style.color).toBe("#ffffff");
    expect(style.borderRadius).toBe("8px");
    expect(style.paddingLeft).toBe("24px");
    expect(style.paddingRight).toBe("24px");
    expect(style.paddingTop).toBe("12px");
    expect(style.paddingBottom).toBe("12px");
    expect(style.fontSize).toBe("14px");
  });

  it("only sets a border when borderWidth is given, defaulting a missing borderColor to transparent rather than leaving no border color at all", () => {
    const style = resolveButtonElementStyle({ borderWidth: 2 });
    expect(style.borderWidth).toBe("2px");
    expect(style.borderStyle).toBe("solid");
    expect(style.borderColor).toBe("transparent");
  });

  it("fullWidth forces block display, 100% width, and centered text", () => {
    const style = resolveButtonElementStyle({ fullWidth: true });
    expect(style.display).toBe("block");
    expect(style.width).toBe("100%");
    expect(style.textAlign).toBe("center");
  });
});

describe("resolveImageElementStyle", () => {
  it("maps objectFit/width/borderRadius", () => {
    const style = resolveImageElementStyle({ objectFit: "contain", width: 200, borderRadius: 12 });
    expect(style.objectFit).toBe("contain");
    expect(style.width).toBe("200px");
    expect(style.borderRadius).toBe("12px");
  });
});

describe("resolveNavElementStyle", () => {
  it("sets --theme-nav-hover-color as a CSS custom property, not a plain style field", () => {
    const style = resolveNavElementStyle({ hoverColor: "#069494" }) as Record<string, string>;
    expect(style["--theme-nav-hover-color"]).toBe("#069494");
  });

  it("resolves fontSize/color/fontWeight directly", () => {
    const style = resolveNavElementStyle({ fontSize: 16, color: "#3f3f46", fontWeight: "600" });
    expect(style.fontSize).toBe("16px");
    expect(style.color).toBe("#3f3f46");
    expect(style.fontWeight).toBe("600");
  });
});

describe("resolvePriceElementStyle", () => {
  it("resolves fontSize/color only — no currency/sale-price fields (those aren't style)", () => {
    const style = resolvePriceElementStyle({ fontSize: 18, color: "#18181b", showCurrencyCode: true });
    expect(style).toEqual({ fontSize: "18px", color: "#18181b" });
  });
});
