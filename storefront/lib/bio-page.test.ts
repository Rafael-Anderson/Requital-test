import { describe, expect, it } from "vitest";
import { resolveBioPageDisplay } from "./bio-page";
import type { BioPageConfig, Shop } from "./types";

function shop(overrides: Partial<Shop>): Pick<Shop, "logoUrl" | "bannerUrl"> {
  return { logoUrl: null, bannerUrl: null, ...overrides };
}

function config(overrides: Partial<BioPageConfig>): BioPageConfig {
  return { logoUrl: null, backgroundUrl: null, description: null, metaTitle: null, metaDescription: null, ...overrides };
}

describe("resolveBioPageDisplay", () => {
  it("falls back to Theme's logo/banner when the bio-specific fields are empty", () => {
    const result = resolveBioPageDisplay(
      shop({ logoUrl: "/uploads/theme/logo.png", bannerUrl: "/uploads/theme/banner.png" }),
      config({}),
    );
    expect(result.logoUrl).toBe("/uploads/theme/logo.png");
    expect(result.backgroundUrl).toBe("/uploads/theme/banner.png");
  });

  it("the bio-specific override wins over Theme when both are set", () => {
    const result = resolveBioPageDisplay(
      shop({ logoUrl: "/uploads/theme/logo.png", bannerUrl: "/uploads/theme/banner.png" }),
      config({ logoUrl: "/uploads/bio-links/mylogo.png", backgroundUrl: "/uploads/bio-links/bg.png" }),
    );
    expect(result.logoUrl).toBe("/uploads/bio-links/mylogo.png");
    expect(result.backgroundUrl).toBe("/uploads/bio-links/bg.png");
  });

  it("is null when neither the bio-specific field nor Theme has one set", () => {
    const result = resolveBioPageDisplay(shop({}), config({}));
    expect(result.logoUrl).toBeNull();
    expect(result.backgroundUrl).toBeNull();
  });

  it("description has no fallback — only the bio-specific value is ever used", () => {
    expect(resolveBioPageDisplay(shop({}), config({ description: "Welcome!" })).description).toBe("Welcome!");
    expect(resolveBioPageDisplay(shop({}), config({})).description).toBeNull();
  });
});
