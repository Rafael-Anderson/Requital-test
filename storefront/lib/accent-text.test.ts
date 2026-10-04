import { describe, expect, it } from "vitest";
import { ACCENT_TEXT_MIN_CONTRAST, resolveAccentText } from "./accent-text";
import { contrastBetween } from "./color-contrast";

// [accent (the scheme's button colour), page background], from backend/src/themes/templates.ts and the legacy default.
const SURFACES: Record<string, [string, string]> = {
  atelier: ["#5A6B54", "#FBFAF7"],
  market: ["#E24A6A", "#FFFFFF"],
  bloom: ["#7C5CFF", "#FFFFFF"],
  heritage: ["#B08D3F", "#F6F3EC"],
  "requital default": ["#069494", "#FFFFFF"],
};

describe("resolveAccentText", () => {
  it("keeps an accent that already reads as text", () => {
    expect(resolveAccentText("#5A6B54", "#FBFAF7")).toBe("#5A6B54");
  });

  it("darkens an accent that is too light for text on a light page, to at least 4.5:1", () => {
    for (const [name, [accent, bg]] of Object.entries(SURFACES)) {
      const out = resolveAccentText(accent, bg);
      expect(contrastBetween(out, bg), name).toBeGreaterThanOrEqual(ACCENT_TEXT_MIN_CONTRAST);
    }
    // Heritage was 2.9:1 before
    expect(contrastBetween("#B08D3F", "#F6F3EC")!).toBeLessThan(3.2);
  });

  it("keeps the hue: only the lightness moves", () => {
    const out = resolveAccentText("#B08D3F", "#F6F3EC");
    expect(out).not.toBe("#B08D3F");
    // still a warm gold: red channel above green above blue
    const n = parseInt(out.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("lightens it instead on a dark page", () => {
    const out = resolveAccentText("#1E3A2F", "#101010");
    expect(contrastBetween(out, "#101010")!).toBeGreaterThanOrEqual(ACCENT_TEXT_MIN_CONTRAST);
    expect(out).not.toBe("#1E3A2F");
  });

  it("leaves a non-hex colour alone", () => {
    expect(resolveAccentText("rebeccapurple", "#ffffff")).toBe("rebeccapurple");
    expect(resolveAccentText("#123456", "currentColor")).toBe("#123456");
  });
});

describe("--color-accent-text is written with the colours", () => {
  it("the scheme path resolves it against the scheme's own background", async () => {
    const { resolveSchemeCssVars } = await import("./theme-css-vars");
    const vars = resolveSchemeCssVars({
      id: "s", name: "Cream", background: "#F6F3EC", text: "#2B2B2B", button: "#B08D3F", buttonLabel: "#2B2B2B", secondaryButtonLabel: "#1E3A2F",
    });
    expect(vars["--color-accent-text"]).toBe(resolveAccentText("#B08D3F", "#F6F3EC"));
    expect(contrastBetween(vars["--color-accent-text"], "#F6F3EC")!).toBeGreaterThanOrEqual(ACCENT_TEXT_MIN_CONTRAST);
    // the button colour itself is untouched (it carries its own label)
    expect(vars["--color-accent"]).toBe("#B08D3F");
  });

  it("the legacy path resolves it against the shop's page background (white by default)", async () => {
    const { resolveThemeCssVars } = await import("./theme-css-vars");
    const vars = resolveThemeCssVars({ brandColor: "#069494", colors: "{}" } as never);
    expect(vars["--color-accent"]).toBe("#069494");
    expect(contrastBetween(vars["--color-accent-text"], "#ffffff")!).toBeGreaterThanOrEqual(ACCENT_TEXT_MIN_CONTRAST);
    const dark = resolveThemeCssVars({ brandColor: "#069494", colors: JSON.stringify({ pageBackgroundColor: "#101010" }) } as never);
    expect(contrastBetween(dark["--color-accent-text"], "#101010")!).toBeGreaterThanOrEqual(ACCENT_TEXT_MIN_CONTRAST);
  });
});
