import { describe, expect, it } from "vitest";
import { resolveSectionMotion } from "./section-motion";
import type { SectionSettings } from "./theme-config-types";

describe("resolveSectionMotion", () => {
  it("both absent ⇒ the exact pre-Phase-A default", () => {
    expect(resolveSectionMotion(undefined)).toEqual({
      entrance: "none",
      stagger: false,
      animateOnce: true,
      trigger: "scroll",
    });
    expect(resolveSectionMotion({})).toEqual({
      entrance: "none",
      stagger: false,
      animateOnce: true,
      trigger: "scroll",
    });
  });

  it("reads the legacy scrollAnimation when no motion object is set", () => {
    expect(resolveSectionMotion({ scrollAnimation: "fade-in" }).entrance).toBe("fade-in");
    expect(resolveSectionMotion({ scrollAnimation: "slide-left" }).entrance).toBe("slide-left");
  });

  it("motion.entrance wins over the legacy scrollAnimation", () => {
    const s: SectionSettings = { scrollAnimation: "fade-in", motion: { entrance: "blur-in" } };
    expect(resolveSectionMotion(s).entrance).toBe("blur-in");
  });

  it("accepts the new entrance vocabulary", () => {
    for (const e of ["scale-in", "blur-in", "mask-reveal"] as const) {
      expect(resolveSectionMotion({ motion: { entrance: e } }).entrance).toBe(e);
    }
  });

  it("degrades an unrecognised entrance to 'none'", () => {
    expect(
      resolveSectionMotion({
        motion: { entrance: "explode" as unknown as NonNullable<SectionSettings["motion"]>["entrance"] },
      }).entrance,
    ).toBe("none");
  });

  it("passes through stagger / animateOnce / trigger", () => {
    expect(resolveSectionMotion({ motion: { stagger: true, animateOnce: false, trigger: "load" } })).toEqual({
      entrance: "none",
      stagger: true,
      animateOnce: false,
      trigger: "load",
    });
  });

  it("animateOnce defaults true unless explicitly false; trigger defaults 'scroll'", () => {
    expect(resolveSectionMotion({ motion: { animateOnce: true } }).animateOnce).toBe(true);
    expect(resolveSectionMotion({ motion: {} }).animateOnce).toBe(true);
    expect(resolveSectionMotion({ motion: { trigger: "scroll" } }).trigger).toBe("scroll");
    expect(resolveSectionMotion({ motion: { trigger: "weird" as unknown as "scroll" } }).trigger).toBe("scroll");
  });
});
