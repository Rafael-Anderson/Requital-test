import { describe, expect, it } from "vitest";
import { focusRingContrastOn, resolveFocusRing, resolveFocusRingCssVars } from "./focus-ring";
import { resolveSchemeCssVars } from "./theme-css-vars";

// The four starter templates' colour schemes, copied from backend/src/themes/templates.ts (the apps
// share no code). Every surface a focus ring can sit on in those themes is one of: a scheme
// background, a scheme button, or a scheme text colour.
const TEMPLATES: Record<string, { name: string; background: string; text: string; button: string; buttonLabel: string }[]> = {
  atelier: [
    { name: "Paper", background: "#FBFAF7", text: "#1A1A17", button: "#5A6B54", buttonLabel: "#FBFAF7" },
    { name: "Ink", background: "#1A1A17", text: "#FBFAF7", button: "#FBFAF7", buttonLabel: "#1A1A17" },
  ],
  market: [
    { name: "Rose", background: "#FFFFFF", text: "#232323", button: "#E24A6A", buttonLabel: "#FFFFFF" },
    { name: "Blush", background: "#FDF1F3", text: "#232323", button: "#E24A6A", buttonLabel: "#FFFFFF" },
  ],
  bloom: [
    { name: "Violet", background: "#FFFFFF", text: "#221B3A", button: "#7C5CFF", buttonLabel: "#FFFFFF" },
    { name: "Mint", background: "#D6F5E8", text: "#221B3A", button: "#7C5CFF", buttonLabel: "#FFFFFF" },
  ],
  heritage: [
    { name: "Cream", background: "#F6F3EC", text: "#2B2B2B", button: "#B08D3F", buttonLabel: "#2B2B2B" },
    { name: "Deep green", background: "#1E3A2F", text: "#F6F3EC", button: "#F6F3EC", buttonLabel: "#1E3A2F" },
  ],
};

describe("focus ring", () => {
  it("keeps the scheme's own text and background when they contrast strongly", () => {
    expect(resolveFocusRing("#1A1A17", "#FBFAF7")).toEqual({ ring: "#1A1A17", halo: "#FBFAF7" });
  });

  it("falls back to black on white for a weak or unreadable pair", () => {
    // grey on grey (about 1.5:1), mid contrast (about 4.6:1), and values that are not plain hex
    expect(resolveFocusRing("#777777", "#999999")).toEqual({ ring: "#000000", halo: "#ffffff" });
    expect(resolveFocusRing("#595959", "#ffffff")).toEqual({ ring: "#000000", halo: "#ffffff" });
    expect(resolveFocusRing("red", "#ffffff")).toEqual({ ring: "#000000", halo: "#ffffff" });
    expect(resolveFocusRing("rgb(0,0,0)", "color-mix(in srgb, red, blue)")).toEqual({ ring: "#000000", halo: "#ffffff" });
  });

  it("is at least 3:1 (WCAG 1.4.11) on every surface of every starter template scheme", () => {
    for (const [template, schemes] of Object.entries(TEMPLATES)) {
      const surfaces = schemes.flatMap((s) => [s.background, s.text, s.button, s.buttonLabel]);
      for (const s of schemes) {
        const ring = resolveFocusRing(s.text, s.background);
        for (const surface of surfaces) {
          expect(focusRingContrastOn(surface, ring), `${template}/${s.name} ring on ${surface}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("the fallback pair is at least 3:1 on any colour", () => {
    const ring = resolveFocusRing("#777777", "#999999");
    for (let v = 0; v <= 255; v += 5) {
      const hex = `#${v.toString(16).padStart(2, "0").repeat(3)}`;
      expect(focusRingContrastOn(hex, ring)).toBeGreaterThanOrEqual(4.5);
    }
    // saturated colours too
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#7c5cff", "#e24a6a", "#b08d3f"]) {
      expect(focusRingContrastOn(hex, ring)).toBeGreaterThanOrEqual(3);
    }
  });

  it("is written together with the scheme colours", () => {
    const vars = resolveSchemeCssVars({
      id: "s",
      name: "s",
      background: "#F6F3EC",
      text: "#2B2B2B",
      button: "#B08D3F",
      buttonLabel: "#2B2B2B",
      secondaryButtonLabel: "#1E3A2F",
    });
    expect(vars["--theme-focus-ring"]).toBe("#2B2B2B");
    expect(vars["--theme-focus-halo"]).toBe("#F6F3EC");
    expect(resolveFocusRingCssVars("#777", "#888")).toEqual({ "--theme-focus-ring": "#000000", "--theme-focus-halo": "#ffffff" });
  });
});
