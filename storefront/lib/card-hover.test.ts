import { describe, expect, it } from "vitest";
import { applyCardHoverCssVars, CARD_HOVER_CSS_VAR_NAMES, resolveCardHoverCssVars } from "./card-hover";

describe("resolveCardHoverCssVars — parity for the four pre-batch values", () => {
  // The exact values the three original inline maps in shop-context.tsx
  // produced before this batch, plus the three new vars resolved to their
  // neutral value — this IS the byte-identical proof for every existing shop
  // (cardHoverEffect is a required field, so there's no "unset" case).
  it("'none' — every var neutral", () => {
    expect(resolveCardHoverCssVars("none")).toEqual({
      "--theme-card-hover-transform": "none",
      "--theme-card-hover-card-transform": "none",
      "--theme-card-hover-card-shadow": "none",
      "--theme-card-hover-filter-base": "none",
      "--theme-card-hover-filter-hover": "none",
      "--theme-card-hover-overlay-opacity": "0",
    });
  });

  it("'zoom' — only the image transform set, unchanged from pre-batch", () => {
    expect(resolveCardHoverCssVars("zoom")).toEqual({
      "--theme-card-hover-transform": "scale(var(--motion-hover-scale, 1.04))",
      "--theme-card-hover-card-transform": "none",
      "--theme-card-hover-card-shadow": "none",
      "--theme-card-hover-filter-base": "none",
      "--theme-card-hover-filter-hover": "none",
      "--theme-card-hover-overlay-opacity": "0",
    });
  });

  it("'rise' — only the card transform + shadow set, unchanged from pre-batch", () => {
    expect(resolveCardHoverCssVars("rise")).toEqual({
      "--theme-card-hover-transform": "none",
      "--theme-card-hover-card-transform": "translateY(var(--motion-hover-lift, -4px))",
      "--theme-card-hover-card-shadow": "var(--motion-hover-shadow, 0 8px 20px rgba(15,23,22,0.12))",
      "--theme-card-hover-filter-base": "none",
      "--theme-card-hover-filter-hover": "none",
      "--theme-card-hover-overlay-opacity": "0",
    });
  });

  it("'swap' — no CSS vars at all (handled by use-product-card-image-index.ts), unchanged from pre-batch", () => {
    expect(resolveCardHoverCssVars("swap")).toEqual({
      "--theme-card-hover-transform": "none",
      "--theme-card-hover-card-transform": "none",
      "--theme-card-hover-card-shadow": "none",
      "--theme-card-hover-filter-base": "none",
      "--theme-card-hover-filter-hover": "none",
      "--theme-card-hover-overlay-opacity": "0",
    });
  });

  it("returns {} for a falsy effect (undefined/null) — defensive, not a live path since cardHoverEffect is required", () => {
    expect(resolveCardHoverCssVars(undefined)).toEqual({});
    expect(resolveCardHoverCssVars(null)).toEqual({});
  });
});

describe("resolveCardHoverCssVars — the five new values", () => {
  it("'desaturate' sets the filter pair only", () => {
    expect(resolveCardHoverCssVars("desaturate")).toEqual({
      "--theme-card-hover-transform": "none",
      "--theme-card-hover-card-transform": "none",
      "--theme-card-hover-card-shadow": "none",
      "--theme-card-hover-filter-base": "saturate(0.55)",
      "--theme-card-hover-filter-hover": "saturate(1)",
      "--theme-card-hover-overlay-opacity": "0",
    });
  });

  it("'overlay' sets the overlay opacity only", () => {
    const v = resolveCardHoverCssVars("overlay");
    expect(v["--theme-card-hover-overlay-opacity"]).toBe("0.12");
    expect(v["--theme-card-hover-transform"]).toBe("none");
    expect(v["--theme-card-hover-filter-base"]).toBe("none");
  });

  it("'shadow' sets the same shadow magnitude as 'rise' but no transform", () => {
    const shadow = resolveCardHoverCssVars("shadow");
    const rise = resolveCardHoverCssVars("rise");
    expect(shadow["--theme-card-hover-card-shadow"]).toBe(rise["--theme-card-hover-card-shadow"]);
    expect(shadow["--theme-card-hover-card-transform"]).toBe("none");
  });

  it("'tilt' sets a fixed-angle card rotate, no shadow", () => {
    expect(resolveCardHoverCssVars("tilt")["--theme-card-hover-card-transform"]).toBe("rotate(-1.5deg)");
    expect(resolveCardHoverCssVars("tilt")["--theme-card-hover-card-shadow"]).toBe("none");
  });

  it("'quick-add-slide' sets no CSS vars — it's a className/DOM change in ProductGridSection.tsx, not a token", () => {
    expect(resolveCardHoverCssVars("quick-add-slide")).toEqual(resolveCardHoverCssVars("none"));
  });
});

describe("applyCardHoverCssVars — the SPA-leak guard", () => {
  function names(style: CSSStyleDeclaration): string[] {
    const out: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const n = style.item(i);
      if (n.startsWith("--theme-card-hover-")) out.push(n);
    }
    return out;
  }

  it("sets all six vars for an effect", () => {
    const el = document.createElement("div");
    applyCardHoverCssVars(el.style, "overlay");
    expect(names(el.style).sort()).toEqual([...CARD_HOVER_CSS_VAR_NAMES].sort());
  });

  it("clears every var on a falsy-effect transition", () => {
    const el = document.createElement("div");
    applyCardHoverCssVars(el.style, "tilt");
    expect(names(el.style).length).toBe(6);
    applyCardHoverCssVars(el.style, undefined);
    expect(names(el.style)).toEqual([]);
  });

  it("switching effects overwrites, never accumulates", () => {
    const el = document.createElement("div");
    applyCardHoverCssVars(el.style, "desaturate");
    applyCardHoverCssVars(el.style, "zoom");
    expect(el.style.getPropertyValue("--theme-card-hover-filter-base")).toBe("none");
    expect(el.style.getPropertyValue("--theme-card-hover-transform")).toBe("scale(var(--motion-hover-scale, 1.04))");
    expect(names(el.style).length).toBe(6);
  });
});
