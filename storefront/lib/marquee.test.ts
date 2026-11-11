import { describe, expect, it } from "vitest";
import { ASSUMED_BAR_WIDTH_PX, estimateItemWidth, initialRepeats, repeatsToCover } from "./marquee";

describe("marquee repeat logic", () => {
  it("repeatsToCover: enough copies that one half is at least as wide as the bar", () => {
    expect(repeatsToCover(1000, 300)).toBe(4); // 4 x 300 = 1200 >= 1000, 3 x 300 = 900 is not
    expect(repeatsToCover(900, 300)).toBe(3);
    expect(repeatsToCover(100, 300)).toBe(1);
    for (const bar of [320, 1024, 1920, 2560, 3840, 5120]) {
      for (const item of [80, 233, 640]) {
        expect(repeatsToCover(bar, item) * item).toBeGreaterThanOrEqual(bar);
      }
    }
  });

  it("an unmeasured (0 / NaN / negative) width never yields 0 or NaN copies", () => {
    for (const [bar, item] of [[0, 100], [100, 0], [Number.NaN, 5], [5, Number.NaN], [-1, 5]] as const) {
      expect(repeatsToCover(bar, item)).toBe(1);
    }
  });

  it("the first render (server and client alike) already covers a 4K-wide bar, even for a short message", () => {
    for (const text of ["Free delivery", "Free delivery on orders over 200", "x"]) {
      expect(initialRepeats(text) * estimateItemWidth(text)).toBeGreaterThanOrEqual(ASSUMED_BAR_WIDTH_PX);
    }
    expect(initialRepeats("")).toBeGreaterThan(1);
  });

  it("is capped so a one-character message does not render thousands of nodes", () => {
    expect(initialRepeats("x")).toBeLessThanOrEqual(128);
  });
});
