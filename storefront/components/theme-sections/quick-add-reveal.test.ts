import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QUICK_ADD_DEFAULT_CLASS, QUICK_ADD_SLIDE_CLASS } from "./ProductGridSection";

// The desktop quick-add button is revealed by hover. A keyboard user must reach and SEE it too:
// it can only take focus if it is not display:none, and a focused control must not stay at opacity-0.
describe("quick-add reveal (keyboard)", () => {
  for (const [name, cls] of [
    ["default", QUICK_ADD_DEFAULT_CLASS],
    ["quick-add-slide", QUICK_ADD_SLIDE_CLASS],
  ] as const) {
    it(`${name}: is focusable (never display:none at sm+) and fades in on focus within the card`, () => {
      expect(cls).toContain("sm:flex");
      expect(cls).not.toContain("sm:group-hover:flex");
      expect(cls).toContain("group-focus-within:opacity-100");
      expect(cls).toContain("group-focus-within:pointer-events-auto");
      // hover reveal is unchanged
      expect(cls).toContain("group-hover:opacity-100");
    });
  }
});

describe("quick-add hover animation", () => {
  const css = fs.readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");

  it("the default desktop quick-add carries the animation hook; the slide variant keeps its own transition", () => {
    expect(QUICK_ADD_DEFAULT_CLASS).toContain("theme-quick-add-anim");
    expect(QUICK_ADD_SLIDE_CLASS).not.toContain("theme-quick-add-anim");
  });

  it("only on hover-capable devices and only without reduced motion, opacity + a few px, about 180ms", () => {
    const m = css.match(/@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}\n/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain(".theme-quick-add-anim");
    expect(body).toMatch(/translateY\(4px\)/);
    expect(body).toMatch(/opacity 180ms/);
    expect(body).toMatch(/transform 180ms/);
    // never outside that media query: no bare rule for the class
    expect(css.replace(m![0], "")).not.toMatch(/\.theme-quick-add-anim\s*\{/);
  });
});
