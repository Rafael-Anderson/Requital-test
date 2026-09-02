import { describe, expect, it } from "vitest";
import { resolveThemeCssVars, resolveSchemeCssVars } from "./shop-context";
import type { ColorScheme } from "./theme-config-types";
import type { Shop } from "./types";

function shop(overrides: Partial<Shop>): Shop {
  return { fontFamily: null, brandColor: null, secondaryColor: null, colors: null, ...overrides } as Shop;
}

describe("resolveThemeCssVars", () => {
  it("falls back to Requital's teal defaults for a totally unconfigured shop", () => {
    const vars = resolveThemeCssVars(null);
    expect(vars["--color-accent"]).toBe("#069494");
    expect(vars["--color-button"]).toBe("#069494");
    expect(vars["--color-header"]).toBe("#ffffff");
    expect(vars["--font-sans"]).toBe("var(--font-inter)");
  });

  it("applies an explicit granular color override", () => {
    const vars = resolveThemeCssVars(shop({ colors: { headerBackgroundColor: "#111111" } }));
    expect(vars["--color-header"]).toBe("#111111");
    // Untouched keys still fall back to their own default, not the one that was set.
    expect(vars["--color-product-name"]).toBe("#171717");
  });

  it("ignores an invalid hex value in a granular color and falls back to the default", () => {
    const vars = resolveThemeCssVars(shop({ colors: { headerBackgroundColor: "not-a-color" } }));
    expect(vars["--color-header"]).toBe("#ffffff");
  });

  it("never applies an unwired color key (no cssVar exists for it to leak into)", () => {
    // productCarouselBackgroundColor is still genuinely unwired — RelatedProducts
    // is still a plain grid, no carousel exists (see theme-colors.ts's header
    // comment). footerBackgroundColor/footerTextColor used to be this test's
    // example but are wired now that components/Footer.tsx is real — see the
    // dedicated test for those below.
    const vars = resolveThemeCssVars(shop({ colors: { productCarouselBackgroundColor: "#000000" } }));
    expect(Object.keys(vars)).not.toContain("--color-product-carousel-bg");
  });

  it("applies footer colors — wired now that components/Footer.tsx is a real element", () => {
    const vars = resolveThemeCssVars(
      shop({ colors: { footerBackgroundColor: "#0a0a0a", footerTextColor: "#eeeeee" } }),
    );
    expect(vars["--color-footer-bg"]).toBe("#0a0a0a");
    expect(vars["--color-footer-fg"]).toBe("#eeeeee");
  });

  it("applies Featured/Slider colors — wired now that Featured Grid and Slideshow are real layouts", () => {
    const vars = resolveThemeCssVars(
      shop({ colors: { featuredBackgroundColor: "#123123", homeSliderBackgroundColor: "#456456", homeSliderColor: "#789789" } }),
    );
    expect(vars["--color-featured-bg"]).toBe("#123123");
    expect(vars["--color-slider-bg"]).toBe("#456456");
    expect(vars["--color-slider-fg"]).toBe("#789789");
  });

  it("Add to Cart Text: an explicit override wins", () => {
    const vars = resolveThemeCssVars(
      shop({ colors: { addToCartButtonColor: "#069494", addToCartTextColor: "#123456" } }),
    );
    expect(vars["--color-add-to-cart-text"]).toBe("#123456");
  });

  it("Add to Cart Text: unset falls back to auto-contrast against the button color, not a fixed white", () => {
    // A near-white add-to-cart button — auto-contrast must pick dark text,
    // not silently default to white-on-white (the exact class of bug the
    // contrast guard exists to prevent, see color-contrast.test.ts).
    const vars = resolveThemeCssVars(shop({ colors: { addToCartButtonColor: "#fefefe" } }));
    expect(vars["--color-add-to-cart-text"]).toBe("#0a0a0a");
  });

  it("Button Color: derives a readable --color-button-foreground the same way", () => {
    const vars = resolveThemeCssVars(shop({ colors: { buttonColor: "#fefefe" } }));
    expect(vars["--color-button-foreground"]).toBe("#0a0a0a");
    expect(vars["--color-button"]).toBe("#fefefe");
  });

  it("defaults --color-mouse-over to `currentColor`, not the Requital accent (A3)", () => {
    // Hover-pill tints must derive from the hovered element's own text color,
    // not leak a fixed teal onto every merchant storefront.
    const vars = resolveThemeCssVars(null);
    expect(vars["--color-mouse-over"]).toBe("currentColor");
    expect(vars["--color-mouse-over"]).not.toBe("#057a7a");
  });

  it("an explicit mouseOverColor override still wins over the currentColor default", () => {
    const vars = resolveThemeCssVars(shop({ colors: { mouseOverColor: "#123456" } }));
    expect(vars["--color-mouse-over"]).toBe("#123456");
  });

  it("derives --color-accent-hover from brandColor when secondaryColor is unset", () => {
    const vars = resolveThemeCssVars(shop({ brandColor: "#ff0000" }));
    expect(vars["--color-accent"]).toBe("#ff0000");
    expect(vars["--color-accent-hover"]).not.toBe("#ff0000");
  });

  it("resets to defaults for null shop (cross-tenant navigation safety)", () => {
    const configured = resolveThemeCssVars(shop({ brandColor: "#ff0000", colors: { headerBackgroundColor: "#111111" } }));
    expect(configured["--color-accent"]).toBe("#ff0000");
    const reset = resolveThemeCssVars(null);
    expect(reset["--color-accent"]).toBe("#069494");
    expect(reset["--color-header"]).toBe("#ffffff");
  });

  // Regression coverage for the storefront dark-mode-mismatch bug: the page
  // canvas (--background) used to flip to near-black under an unconditional
  // OS prefers-color-scheme media query, independent of this function
  // entirely and independent of every merchant-controlled color (header,
  // buttons, ...) — a visitor's OS preference overrode branding the shop
  // never asked to change. Fixed by retiring that media query and giving
  // --background a real merchant-facing source (Page Background Color) that
  // flows through this exact same override mechanism as every other field,
  // always defaulting light regardless of the visitor's OS setting.
  describe("pageBackgroundColor", () => {
    it("defaults --background to white, not an OS-dark-mode-dependent value", () => {
      const vars = resolveThemeCssVars(null);
      expect(vars["--background"]).toBe("#ffffff");
    });

    it("an explicit merchant override applies, same as any other granular color", () => {
      const vars = resolveThemeCssVars(shop({ colors: { pageBackgroundColor: "#111111" } }));
      expect(vars["--background"]).toBe("#111111");
    });

    it("resolveThemeCssVars takes no OS/dark-mode parameter at all — same output regardless of caller", () => {
      // Deliberately calling with no second argument at all: the function
      // signature itself no longer accepts one, so there's no way for a
      // caller to accidentally reintroduce an OS-driven branch here.
      const vars = resolveThemeCssVars(null);
      expect(vars["--color-product-name"]).toBe("#171717");
      expect(vars["--color-price-main"]).toBe("#71717a");
      expect(vars["--color-stroke"]).toBe("#e4e4e7");
    });
  });
});

// The admin Colors panel edits globalSettings.colorSchemes[]; the active
// scheme (colorSchemes[0]) must reach the page canvas / body text / header /
// product-name vars, not just --color-accent* + --color-popover* (the bug:
// "changing Background to black did nothing on the storefront").
describe("resolveSchemeCssVars", () => {
  // Matches DEFAULT_THEME_CONFIG.globalSettings.colorSchemes[0] (backend
  // constants.ts) — every currently-themed shop is still on this.
  const DEFAULT_SCHEME: ColorScheme = {
    id: "scheme-light",
    name: "Scheme 1",
    background: "#ffffff",
    text: "#18181b",
    button: "#069494",
    buttonLabel: "#ffffff",
    secondaryButtonLabel: "#069494",
  };

  it("returns {} for a missing scheme (un-themed shop — applyTheme's Appearance Colors stand)", () => {
    expect(resolveSchemeCssVars(null)).toEqual({});
    expect(resolveSchemeCssVars(undefined)).toEqual({});
  });

  it("a custom scheme drives all four surface groups — page, body text, header, product name", () => {
    const vars = resolveSchemeCssVars({
      ...DEFAULT_SCHEME,
      background: "#000000",
      text: "#ff0000",
      button: "#123456",
      buttonLabel: "#abcdef",
    });
    // background → page canvas + header base
    expect(vars["--background"]).toBe("#000000");
    expect(vars["--color-header"]).toBe("#000000");
    // text → body text + header text + product name
    expect(vars["--foreground"]).toBe("#ff0000");
    expect(vars["--color-header-fg"]).toBe("#ff0000");
    expect(vars["--color-product-name"]).toBe("#ff0000");
    // button pair unchanged in behaviour, still mapped
    expect(vars["--color-accent"]).toBe("#123456");
    expect(vars["--color-accent-hover"]).toBe("#123456");
    expect(vars["--color-accent-foreground"]).toBe("#abcdef");
  });

  it("the default scheme is a visual no-op — maps only to the neutral light baseline", () => {
    const vars = resolveSchemeCssVars(DEFAULT_SCHEME);
    expect(vars["--background"]).toBe("#ffffff");
    expect(vars["--color-header"]).toBe("#ffffff");
    // #18181b vs globals.css's #171717 fallback is imperceptible (rgb 24/24/27
    // vs 23/23/23); no themed shop's rendering changes.
    expect(vars["--foreground"]).toBe("#18181b");
    expect(vars["--color-header-fg"]).toBe("#18181b");
    expect(vars["--color-product-name"]).toBe("#18181b");
    expect(vars["--color-accent"]).toBe("#069494");
  });

  it("does not map secondaryButtonLabel — no secondary button variant renders", () => {
    const vars = resolveSchemeCssVars({ ...DEFAULT_SCHEME, secondaryButtonLabel: "#ff00ff" });
    expect(Object.values(vars)).not.toContain("#ff00ff");
  });
});
