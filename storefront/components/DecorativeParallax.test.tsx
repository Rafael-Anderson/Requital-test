import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DecorativeParallax from "./DecorativeParallax";

let themeConfig: unknown = null;
let reduced = false;
let wide = true;
let scrollY = 0;
vi.mock("@/lib/shop-context", () => ({ useShop: () => ({ themeConfig }) }));
vi.mock("@/lib/use-reduced-motion", () => ({ useReducedMotion: () => reduced }));
vi.mock("@/lib/use-min-width", () => ({ useMinWidth: () => wide }));
vi.mock("@/lib/use-scroll-value", () => ({ useScrollValue: () => ({ y: scrollY, direction: "down" }) }));

afterEach(() => {
  cleanup();
  themeConfig = null;
  reduced = false;
  wide = true;
  scrollY = 0;
});

const cfg = (motion: Record<string, unknown>) => ({ globalSettings: { motion } });
const blobs = (c: HTMLElement) => c.querySelectorAll(".theme-decorative-blob");

describe("DecorativeParallax (§8.13.C item 15)", () => {
  it("no-op: decorativeParallax unset ⇒ renders nothing", () => {
    themeConfig = cfg({});
    const { container } = render(<DecorativeParallax />);
    expect(container).toBeEmptyDOMElement();
  });

  it("killed by intensity 'none' even when decorativeParallax is true", () => {
    themeConfig = cfg({ decorativeParallax: true, intensity: "none" });
    const { container } = render(<DecorativeParallax />);
    expect(container).toBeEmptyDOMElement();
  });

  it("killed by reduced motion", () => {
    reduced = true;
    themeConfig = cfg({ decorativeParallax: true });
    const { container } = render(<DecorativeParallax />);
    expect(container).toBeEmptyDOMElement();
  });

  it("killed on a sub-640px viewport", () => {
    wide = false;
    themeConfig = cfg({ decorativeParallax: true });
    const { container } = render(<DecorativeParallax />);
    expect(container).toBeEmptyDOMElement();
  });

  it("enabled ⇒ exactly 5 blobs (the hard cap), each with a scroll-driven translate3d", () => {
    scrollY = 500;
    themeConfig = cfg({ decorativeParallax: true, intensity: "expressive" });
    const { container } = render(<DecorativeParallax />);
    const els = blobs(container);
    expect(els.length).toBe(5);
    // rates are all < 0.2, so every blob translates less than scrollY
    for (const el of els) {
      const m = (el as HTMLElement).style.transform.match(/translate3d\(0, ([\d.]+)px, 0\)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(0);
      expect(Number(m![1])).toBeLessThan(scrollY * 0.2);
    }
  });
});
