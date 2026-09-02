import { describe, expect, it } from "vitest";
import {
  resolveTextElementStyle,
  resolveButtonElementStyle,
  resolveImageElementStyle,
  resolveNavElementStyle,
  resolveMenuBarBackground,
  headerNavSeamless,
  resolvePriceElementStyle,
  resolveIconStrokeWidth,
  resolveIconElementStyle,
  themeButtonBaseStyle,
  resolveButtonFillStyle,
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

describe("resolveMenuBarBackground", () => {
  it("returns undefined when neither menuBarBackground nor a solid header background is set", () => {
    expect(resolveMenuBarBackground(undefined)).toBeUndefined();
    expect(resolveMenuBarBackground({})).toBeUndefined();
  });

  it("uses the explicit menuBarBackground key when set, independent of the header's own background", () => {
    const result = resolveMenuBarBackground({
      menuBarBackground: "#123456",
      background: { type: "solid", color: "#ffffff" },
    });
    expect(result).toBe("#123456");
  });

  it("falls back to the header's own color when the header background is a plain solid", () => {
    const result = resolveMenuBarBackground({ background: { type: "solid", color: "#abcdef" } });
    expect(result).toBe("#abcdef");
  });

  it("does not fall back to a gradient or image header background — no single color to hand down", () => {
    expect(resolveMenuBarBackground({ background: { type: "gradient", gradientFrom: "#000", gradientTo: "#fff" } })).toBeUndefined();
    expect(resolveMenuBarBackground({ background: { type: "image", imageUrl: "/uploads/x.png" } })).toBeUndefined();
  });
});

describe("headerNavSeamless (A2 seam fix)", () => {
  it("is true when menuBarBackground exactly matches a solid header background — no divider", () => {
    expect(
      headerNavSeamless({ menuBarBackground: "#101010", background: { type: "solid", color: "#101010" } }),
    ).toBe(true);
  });

  it("is true (case-insensitively) when the menu bar inherits the solid header color with no explicit key", () => {
    expect(headerNavSeamless({ background: { type: "solid", color: "#ABCDEF" } })).toBe(true);
  });

  it("is false when the two backgrounds differ — the hairline divider stays", () => {
    expect(
      headerNavSeamless({ menuBarBackground: "#111111", background: { type: "solid", color: "#ffffff" } }),
    ).toBe(false);
  });

  it("is false when there is no comparable header color (unset, gradient or image) — divider stays", () => {
    expect(headerNavSeamless(undefined)).toBe(false);
    expect(headerNavSeamless({})).toBe(false);
    expect(headerNavSeamless({ menuBarBackground: "#111111", background: { type: "gradient", gradientFrom: "#000", gradientTo: "#fff" } })).toBe(false);
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
  it("returns the CSS-var-driven defaults every primary button starts from, legacy Layout mode's button shape taking precedence over the new Buttons category's own corner radius", () => {
    const style = themeButtonBaseStyle();
    expect(style.borderRadius).toBe("var(--theme-btn-primary-radius, var(--theme-radius, 8px))");
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

describe("resolveButtonFillStyle", () => {
  it("solid (or unset) returns an empty style — the element's own bg-accent/text-accent-foreground classes already render it", () => {
    expect(resolveButtonFillStyle("solid")).toEqual({});
    expect(resolveButtonFillStyle(undefined)).toEqual({});
  });

  it("outline is a transparent background with a colored border and text", () => {
    const style = resolveButtonFillStyle("outline");
    expect(style.background).toBe("transparent");
    expect(style.color).toBe("var(--color-accent)");
    expect(style.borderColor).toBe("var(--color-accent)");
    expect(style.borderWidth).toBe("2px");
  });

  it("ghost is a transparent background with colored text and no border", () => {
    const style = resolveButtonFillStyle("ghost");
    expect(style.background).toBe("transparent");
    expect(style.color).toBe("var(--color-accent)");
    expect(style.borderColor).toBe("transparent");
    expect(style.borderWidth).toBe("0px");
  });
});
