import { describe, expect, it } from "vitest";
import { resolveNavLinkStyle } from "./nav-menu-style";

describe("resolveNavLinkStyle", () => {
  it("absent / 'pill' is the byte-identical legacy look (rounded-full, zinc text, no heading font)", () => {
    for (const v of [undefined, "pill", "bogus"]) {
      const r = resolveNavLinkStyle(v as string | undefined);
      expect(r.className).toContain("rounded-full");
      expect(r.className).toContain("text-zinc-600");
      expect(r.useHeadingFont).toBe(false);
    }
  });

  it("every non-pill style opts into the heading font and drops the hardcoded pill/zinc", () => {
    for (const v of ["pill-solid", "underline", "caps", "bordered"]) {
      const r = resolveNavLinkStyle(v);
      expect(r.useHeadingFont).toBe(true);
      expect(r.className).not.toContain("rounded-full");
      expect(r.className).not.toContain("text-zinc-600");
    }
  });

  it("non-pill styles colour themselves from currentColor (readable on a dark header row)", () => {
    // bordered + pill-solid use currentColor-derived border/bg; underline +
    // caps just inherit colour with an opacity. None pins a fixed hue.
    expect(resolveNavLinkStyle("bordered").className).toContain("border-current/");
    expect(resolveNavLinkStyle("pill-solid").className).toContain("bg-current/");
    expect(resolveNavLinkStyle("underline").className).toContain("opacity-");
    expect(resolveNavLinkStyle("caps").className).toContain("uppercase");
  });

  it("styles that carry a border/background follow the radius scale", () => {
    expect(resolveNavLinkStyle("bordered").className).toContain("theme-round-md");
    expect(resolveNavLinkStyle("pill-solid").className).toContain("theme-round-lg");
  });
});
