import { describe, expect, it } from "vitest";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveImageElementStyle,
  resolveNavElementStyle,
  resolvePriceElementStyle,
  resolveIconStrokeWidth,
  resolveIconElementStyle,
  themeButtonBaseStyle,
  themeTextPresetStyle,
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

describe("resolveIconStrokeWidth", () => {
  it("maps the three named presets to real lucide strokeWidth numbers", () => {
    expect(resolveIconStrokeWidth("thin")).toBe(1.25);
    expect(resolveIconStrokeWidth("default")).toBe(2);
    expect(resolveIconStrokeWidth("heavy")).toBe(2.75);
  });

  it("falls back to lucide's own default (2) for an unset/unknown value — pixel-identical to before this setting existed", () => {
    expect(resolveIconStrokeWidth(undefined)).toBe(2);
    expect(resolveIconStrokeWidth("not-a-real-value")).toBe(2);
  });
});

describe("resolveIconElementStyle", () => {
  it("maps color and size (as an explicit width+height pair, not a font-size-like single value)", () => {
    const style = resolveIconElementStyle({ color: "#069494", size: 24 });
    expect(style.color).toBe("#069494");
    expect(style.width).toBe("24px");
    expect(style.height).toBe("24px");
  });

  it("returns an empty style when nothing is set", () => {
    expect(resolveIconElementStyle({})).toEqual({});
  });
});

describe("themeButtonBaseStyle", () => {
  it("returns the CSS-var-driven defaults every primary button starts from", () => {
    const style = themeButtonBaseStyle();
    expect(style.borderRadius).toBe("var(--theme-radius, 8px)");
    expect(style.borderWidth).toBe("var(--theme-button-border-width, 0px)");
    expect(style.borderStyle).toBe("solid");
    expect(style.textTransform).toBe("var(--theme-button-text-transform, none)");
    expect(style.fontFamily).toBe("var(--theme-button-font, inherit)");
  });
});

describe("themeTextPresetStyle", () => {
  it("resolves size/line-height/letter-spacing/transform/font as var() lookups with a real fallback for a heading preset", () => {
    const style = themeTextPresetStyle("h1");
    expect(style.fontSize).toBe("var(--text-h1-size, 36px)");
    expect(style.lineHeight).toBe("var(--text-h1-line-height, 1.4)");
    expect(style.letterSpacing).toBe("var(--text-h1-letter-spacing, normal)");
    expect(style.textTransform).toBe("var(--text-h1-transform, none)");
    expect(style.fontFamily).toBe("var(--text-h1-font, var(--theme-heading-font, inherit))");
  });

  it("uses a smaller fallback size per heading level", () => {
    expect(themeTextPresetStyle("h6").fontSize).toBe("var(--text-h6-size, 16px)");
  });

  it("paragraph has no letterSpacing/textTransform/fontFamily — those fields don't exist on ParagraphTextPreset", () => {
    const style = themeTextPresetStyle("paragraph");
    expect(style.fontSize).toBe("var(--text-paragraph-size, 16px)");
    expect(style.lineHeight).toBe("var(--text-paragraph-line-height, 1.4)");
    expect(style.letterSpacing).toBeUndefined();
    expect(style.textTransform).toBeUndefined();
    expect(style.fontFamily).toBeUndefined();
  });
});
