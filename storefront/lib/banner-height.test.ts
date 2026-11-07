import { describe, expect, it } from "vitest";
import { bannerHeightVars, clampBannerHeight } from "./banner-height";

describe("banner height", () => {
  it("clamps to 120 to 900 and rounds", () => {
    expect(clampBannerHeight(119)).toBe(120);
    expect(clampBannerHeight(901)).toBe(900);
    expect(clampBannerHeight(300.6)).toBe(301);
  });
  it("is undefined for anything that is not a finite number (so the caller keeps its current height)", () => {
    for (const bad of [undefined, null, "300", Number.NaN, Infinity, {}]) expect(clampBannerHeight(bad)).toBeUndefined();
    expect(bannerHeightVars(undefined, undefined)).toBeUndefined();
  });
  it("one value serves both breakpoints", () => {
    expect(bannerHeightVars(400, undefined)).toEqual({ "--theme-banner-h": "400px", "--theme-banner-h-m": "400px" });
    expect(bannerHeightVars(undefined, 250)).toEqual({ "--theme-banner-h": "250px", "--theme-banner-h-m": "250px" });
  });
});
