import { describe, expect, it } from "vitest";
import { resolveBannerHeights, validBannerHeight } from "./banner-height";

describe("banner height", () => {
  it("accepts only whole numbers from 120 to 900", () => {
    expect(validBannerHeight(120)).toBe(120);
    expect(validBannerHeight(900)).toBe(900);
    for (const bad of [119, 901, 300.5, "300", null, undefined, NaN]) {
      expect(validBannerHeight(bad)).toBeUndefined();
    }
  });
  it("falls back, and mobile follows desktop", () => {
    expect(resolveBannerHeights(undefined, undefined, 220)).toEqual({ desktop: 220, mobile: 220 });
    expect(resolveBannerHeights(400, undefined, 220)).toEqual({ desktop: 400, mobile: 400 });
    expect(resolveBannerHeights(400, 200, 220)).toEqual({ desktop: 400, mobile: 200 });
    expect(resolveBannerHeights(undefined, undefined)).toBeNull();
  });
});
