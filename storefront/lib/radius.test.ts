import { describe, expect, it } from "vitest";
import {
  applyRadiusCssVars,
  RADIUS_CSS_VAR_NAMES,
  resolveRadiusCssVars,
  resolveThemeRadius,
} from "./radius";
import type { RadiusSettings } from "./theme-config-types";

describe("resolveRadiusCssVars", () => {
  it("returns {} for the no-op cases (unset / {} / unknown / applyToButtons alone)", () => {
    expect(resolveRadiusCssVars(undefined)).toEqual({});
    expect(resolveRadiusCssVars(null)).toEqual({});
    expect(resolveRadiusCssVars({})).toEqual({});
    expect(resolveRadiusCssVars({ preset: "bogus" as unknown as RadiusSettings["preset"] })).toEqual({});
    expect(resolveRadiusCssVars({ applyToButtons: true })).toEqual({});
  });

  it("`rounded` is a near-today baseline (md 8 = rounded-lg, lg 12 = rounded-xl) — not the no-op", () => {
    expect(resolveRadiusCssVars({ preset: "rounded" })).toEqual({
      "--radius-sm": "6px",
      "--radius-md": "8px",
      "--radius-lg": "12px",
    });
  });

  it("each preset emits all three vars", () => {
    for (const preset of ["sharp", "subtle", "rounded", "soft", "pill"] as const) {
      const v = resolveRadiusCssVars({ preset });
      expect(Object.keys(v).sort()).toEqual([...RADIUS_CSS_VAR_NAMES].sort());
    }
    expect(resolveRadiusCssVars({ preset: "sharp" })["--radius-lg"]).toBe("0px");
    expect(resolveRadiusCssVars({ preset: "pill" })["--radius-lg"]).toBe("9999px");
  });

  it("RADIUS_CSS_VAR_NAMES is a superset of every key any preset emits", () => {
    for (const preset of ["sharp", "subtle", "rounded", "soft", "pill"] as const) {
      for (const k of Object.keys(resolveRadiusCssVars({ preset }))) {
        expect(RADIUS_CSS_VAR_NAMES).toContain(k);
      }
    }
  });
});

describe("applyRadiusCssVars — the SPA-leak guard", () => {
  function names(style: CSSStyleDeclaration): string[] {
    const out: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const n = style.item(i);
      if (n.startsWith("--radius-")) out.push(n);
    }
    return out;
  }

  it("sets all three for a preset", () => {
    const el = document.createElement("div");
    applyRadiusCssVars(el.style, { preset: "soft" });
    expect(el.style.getPropertyValue("--radius-md")).toBe("16px");
    expect(names(el.style).sort()).toEqual([...RADIUS_CSS_VAR_NAMES].sort());
  });

  it("clears every --radius-* on a set → unset transition", () => {
    const el = document.createElement("div");
    applyRadiusCssVars(el.style, { preset: "pill" });
    expect(names(el.style).length).toBe(3);
    applyRadiusCssVars(el.style, undefined);
    expect(names(el.style)).toEqual([]);
    applyRadiusCssVars(el.style, { preset: "sharp" });
    applyRadiusCssVars(el.style, {});
    expect(names(el.style)).toEqual([]);
  });

  it("switching presets overwrites, never accumulates", () => {
    const el = document.createElement("div");
    applyRadiusCssVars(el.style, { preset: "pill" });
    applyRadiusCssVars(el.style, { preset: "subtle" });
    expect(el.style.getPropertyValue("--radius-md")).toBe("4px");
    expect(names(el.style).length).toBe(3);
  });
});

describe("resolveThemeRadius — the --theme-radius bridge", () => {
  it("no scale ⇒ ${cornerRadius}px, byte-identical to the old expression (any value)", () => {
    expect(resolveThemeRadius(undefined, 8)).toBe("8px");
    expect(resolveThemeRadius({}, 8)).toBe("8px");
    expect(resolveThemeRadius({ preset: "soft" }, 8)).toBe("8px"); // preset but applyToButtons off
    expect(resolveThemeRadius(undefined, 12)).toBe("12px");
    expect(resolveThemeRadius({ preset: "sharp" }, 15)).toBe("15px");
  });

  it("cornerRadius ALWAYS wins over a preset unless applyToButtons is on", () => {
    expect(resolveThemeRadius({ preset: "pill", applyToButtons: false }, 8)).toBe("8px");
  });

  it("applyToButtons + preset ⇒ the scale's --radius-md", () => {
    expect(resolveThemeRadius({ preset: "soft", applyToButtons: true }, 8)).toBe("16px");
    expect(resolveThemeRadius({ preset: "sharp", applyToButtons: true }, 8)).toBe("0px");
  });

  it("applyToButtons on but no preset ⇒ falls back to ${cornerRadius}px", () => {
    expect(resolveThemeRadius({ applyToButtons: true }, 8)).toBe("8px");
  });
});
