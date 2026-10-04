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
