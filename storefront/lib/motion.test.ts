import { describe, expect, it } from "vitest";
import { applyMotionCssVars, MOTION_CSS_VAR_NAMES, resolveMotionCssVars } from "./motion";
import type { MotionSettings } from "./theme-config-types";

describe("resolveMotionCssVars", () => {
  describe("the no-op contract (absent ⇒ {})", () => {
    it("returns {} for undefined / null", () => {
      expect(resolveMotionCssVars(undefined)).toEqual({});
      expect(resolveMotionCssVars(null)).toEqual({});
    });

    it("returns {} for an empty object (DEFAULT_THEME_CONFIG seeds this)", () => {
      expect(resolveMotionCssVars({})).toEqual({});
    });

    it("returns {} when other fields are set but intensity is not", () => {
      expect(resolveMotionCssVars({ speed: 1.5, easing: "snappy", scrollMotion: false })).toEqual({});
    });

    it("returns {} for an unrecognised intensity value", () => {
      expect(resolveMotionCssVars({ intensity: "wild" as unknown as MotionSettings["intensity"] })).toEqual({});
    });
  });

  describe("standard — a near-today baseline, explicitly NOT byte-identical to unset", () => {
    const vars = resolveMotionCssVars({ intensity: "standard" });

    it("emits every base token", () => {
      expect(vars["--motion-duration-fast"]).toBe("150ms");
      expect(vars["--motion-duration-base"]).toBe("320ms"); // vs today's literal 300ms — deliberate
      expect(vars["--motion-duration-slow"]).toBe("600ms");
      expect(vars["--motion-entrance-distance"]).toBe("24px");
      expect(vars["--motion-stagger"]).toBe("60ms");
      expect(vars["--motion-hover-lift"]).toBe("-4px");
      expect(vars["--motion-hover-scale"]).toBe("1.04");
      expect(vars["--motion-hover-shadow"]).toBe("0 8px 20px rgba(15,23,22,0.12)");
      expect(vars["--motion-ease"]).toBe("cubic-bezier(0.22,0.61,0.36,1)"); // vs the literal `ease-out`
      expect(vars["--motion-marquee-duration"]).toBe("18s");
    });

    it("emits the mobile tier at one step gentler (standard → subtle)", () => {
      expect(vars["--motion-duration-base-m"]).toBe("220ms");
      expect(vars["--motion-entrance-distance-m"]).toBe("12px");
      expect(vars["--motion-hover-scale-m"]).toBe("1.02");
      expect(vars["--motion-marquee-duration-m"]).toBe("24s");
    });
  });

  describe("none — collapses motion without disabling the marquee ticker", () => {
    const vars = resolveMotionCssVars({ intensity: "none" });
    it("zeroes durations / distances / lift, scale to 1", () => {
      expect(vars["--motion-duration-fast"]).toBe("0ms");
      expect(vars["--motion-duration-base"]).toBe("0ms");
      expect(vars["--motion-duration-slow"]).toBe("0ms");
      expect(vars["--motion-entrance-distance"]).toBe("0px");
      expect(vars["--motion-hover-lift"]).toBe("0px");
      expect(vars["--motion-hover-scale"]).toBe("1");
      expect(vars["--motion-hover-shadow"]).toBe("none");
    });
    it("mobile tier of none is also none", () => {
      expect(vars["--motion-duration-base-m"]).toBe("0ms");
      expect(vars["--motion-hover-scale-m"]).toBe("1");
    });
  });

  describe("expressive → mobile steps to standard", () => {
    const vars = resolveMotionCssVars({ intensity: "expressive" });
    it("base is expressive, -m is standard", () => {
      expect(vars["--motion-duration-base"]).toBe("480ms");
      expect(vars["--motion-hover-lift"]).toBe("-8px");
      expect(vars["--motion-duration-base-m"]).toBe("320ms");
      expect(vars["--motion-hover-lift-m"]).toBe("-4px");
    });
  });

  describe("speed multiplier", () => {
    it("halves durations at 0.5 (both tiers)", () => {
      const vars = resolveMotionCssVars({ intensity: "standard", speed: 0.5 });
      expect(vars["--motion-duration-base"]).toBe("160ms");
      expect(vars["--motion-stagger"]).toBe("30ms");
      expect(vars["--motion-duration-base-m"]).toBe("110ms");
    });
    it("clamps to [0.5, 2]", () => {
      expect(resolveMotionCssVars({ intensity: "subtle", speed: 99 })["--motion-duration-base"]).toBe("440ms");
      expect(resolveMotionCssVars({ intensity: "subtle", speed: 0.01 })["--motion-duration-base"]).toBe("110ms");
    });
    it("ignores a non-finite speed", () => {
      expect(resolveMotionCssVars({ intensity: "standard", speed: NaN })["--motion-duration-base"]).toBe("320ms");
    });
    it("does not scale distances or scale factors", () => {
      const vars = resolveMotionCssVars({ intensity: "standard", speed: 2 });
      expect(vars["--motion-entrance-distance"]).toBe("24px");
      expect(vars["--motion-hover-scale"]).toBe("1.04");
    });
  });

  describe("named easing overrides the intensity curve on both tiers", () => {
    it("overshoot", () => {
      const vars = resolveMotionCssVars({ intensity: "expressive", easing: "overshoot" });
      expect(vars["--motion-ease"]).toBe("cubic-bezier(0.34,1.56,0.64,1)");
      expect(vars["--motion-ease-m"]).toBe("cubic-bezier(0.34,1.56,0.64,1)");
    });
    it("linear", () => {
      expect(resolveMotionCssVars({ intensity: "subtle", easing: "linear" })["--motion-ease"]).toBe("linear");
    });
    it("'standard' easing keeps the intensity's own curve", () => {
      const vars = resolveMotionCssVars({ intensity: "subtle", easing: "standard" });
      expect(vars["--motion-ease"]).toBe("cubic-bezier(0.33,1,0.68,1)");
    });
  });
});

describe("applyMotionCssVars — the SPA-leak guard", () => {
  function names(style: CSSStyleDeclaration): string[] {
    const out: string[] = [];
    for (let i = 0; i < style.length; i++) {
      const n = style.item(i);
      if (n.startsWith("--motion-")) out.push(n);
    }
    return out;
  }

  it("MOTION_CSS_VAR_NAMES is a superset of everything resolveMotionCssVars can emit (so the clear loop covers it)", () => {
    for (const intensity of ["none", "subtle", "standard", "expressive"] as const) {
      const emitted = Object.keys(resolveMotionCssVars({ intensity }));
      for (const k of emitted) expect(MOTION_CSS_VAR_NAMES).toContain(k);
    }
  });

  it("sets the tokens for a configured theme", () => {
    const el = document.createElement("div");
    applyMotionCssVars(el.style, { intensity: "standard" });
    expect(el.style.getPropertyValue("--motion-duration-base")).toBe("320ms");
    expect(el.style.getPropertyValue("--motion-hover-scale-m")).toBe("1.02");
    expect(names(el.style).sort()).toEqual([...MOTION_CSS_VAR_NAMES].sort());
  });

  it("clears every --motion-* prop on a set → unset transition (motion removed)", () => {
    const el = document.createElement("div");
    applyMotionCssVars(el.style, { intensity: "expressive", speed: 1.5, easing: "overshoot" });
    expect(names(el.style).length).toBe(MOTION_CSS_VAR_NAMES.length);

    applyMotionCssVars(el.style, undefined);
    expect(names(el.style)).toEqual([]);
    expect(el.style.getPropertyValue("--motion-duration-base")).toBe("");
    expect(el.style.getPropertyValue("--motion-ease-m")).toBe("");
  });

  it("clears on a transition to an empty object ({} — the DEFAULT_THEME_CONFIG seed / a preview config with motion removed)", () => {
    const el = document.createElement("div");
    applyMotionCssVars(el.style, { intensity: "subtle" });
    applyMotionCssVars(el.style, {});
    expect(names(el.style)).toEqual([]);
  });

  it("switching between two configured themes overwrites, never accumulates", () => {
    const el = document.createElement("div");
    applyMotionCssVars(el.style, { intensity: "expressive" });
    applyMotionCssVars(el.style, { intensity: "subtle" });
    expect(el.style.getPropertyValue("--motion-duration-base")).toBe("220ms"); // subtle, not 480
    expect(names(el.style).length).toBe(MOTION_CSS_VAR_NAMES.length); // no leftovers
  });
});
