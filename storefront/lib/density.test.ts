import { describe, expect, it } from "vitest";
import { applyDensityCssVars, DENSITY_CSS_VAR_NAMES, resolveDensityCssVars } from "./density";
import type { DensitySettings } from "./theme-config-types";

describe("resolveDensityCssVars", () => {
  it("returns {} for the no-op cases (unset / null / {} / unknown preset)", () => {
    expect(resolveDensityCssVars(undefined)).toEqual({});
    expect(resolveDensityCssVars(null)).toEqual({});
    expect(resolveDensityCssVars({})).toEqual({});
    expect(resolveDensityCssVars({ preset: "bogus" as unknown as DensitySettings["preset"] })).toEqual({});
  });

  it("`cozy` reproduces today's values explicitly (near-today baseline, not the no-op)", () => {
    expect(resolveDensityCssVars({ preset: "cozy" })).toEqual({
      "--section-py": "2rem",
      "--grid-gap": "1.5rem",
      "--grid-gap-m": "1rem",
      "--section-heading-gap": "1rem",
    });
  });

  it("each preset emits all four vars", () => {
    for (const preset of ["compact", "cozy", "comfortable", "spacious"] as const) {
      const v = resolveDensityCssVars({ preset });
      expect(Object.keys(v).sort()).toEqual([...DENSITY_CSS_VAR_NAMES].sort());
    }
    expect(resolveDensityCssVars({ preset: "compact" })["--section-py"]).toBe("1.5rem");
    expect(resolveDensityCssVars({ preset: "spacious" })["--section-py"]).toBe("3.5rem");
  });

  it("DENSITY_CSS_VAR_NAMES is a superset of every key any preset emits", () => {
    for (const preset of ["compact", "cozy", "comfortable", "spacious"] as const) {
      for (const k of Object.keys(resolveDensityCssVars({ preset }))) {
        expect(DENSITY_CSS_VAR_NAMES).toContain(k);
      }
    }
  });
});

describe("applyDensityCssVars — the SPA-leak guard", () => {
  function names(style: CSSStyleDeclaration): string[] {
    const out: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const n = style.item(i);
      if (n.startsWith("--section-") || n.startsWith("--grid-")) out.push(n);
    }
    return out;
  }

  it("sets all four for a preset", () => {
    const el = document.createElement("div");
    applyDensityCssVars(el.style, { preset: "spacious" });
    expect(el.style.getPropertyValue("--section-py")).toBe("3.5rem");
    expect(names(el.style).sort()).toEqual([...DENSITY_CSS_VAR_NAMES].sort());
  });

  it("clears every var on a set → unset transition", () => {
    const el = document.createElement("div");
    applyDensityCssVars(el.style, { preset: "comfortable" });
    expect(names(el.style).length).toBe(4);
    applyDensityCssVars(el.style, undefined);
    expect(names(el.style)).toEqual([]);
    applyDensityCssVars(el.style, { preset: "compact" });
    applyDensityCssVars(el.style, {});
    expect(names(el.style)).toEqual([]);
  });

  it("switching presets overwrites, never accumulates", () => {
    const el = document.createElement("div");
    applyDensityCssVars(el.style, { preset: "spacious" });
    applyDensityCssVars(el.style, { preset: "compact" });
    expect(el.style.getPropertyValue("--grid-gap")).toBe("1rem");
    expect(names(el.style).length).toBe(4);
  });
});
