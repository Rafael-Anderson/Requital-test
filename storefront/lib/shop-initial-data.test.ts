import { describe, expect, it } from "vitest";
import { buildShopInitialData } from "./shop-initial-data";
import type { Outlet, Shop } from "./types";
import type { ThemeConfig } from "./theme-config-types";

const shop = (published: boolean) => ({ id: 1, published }) as unknown as Shop;
const outlets = [{ id: 7 }] as unknown as Outlet[];
const theme = { sections: [] } as unknown as ThemeConfig;

describe("buildShopInitialData", () => {
  it("seeds a published shop with its theme and outlets", () => {
    expect(buildShopInitialData("s", shop(true), theme, outlets)).toEqual({ shopSlug: "s", shop: shop(true), outlets, themeConfig: theme });
  });

  it("treats 'no published theme' (null) as a real answer, not as missing", () => {
    expect(buildShopInitialData("s", shop(true), null, outlets)?.themeConfig).toBeNull();
  });

  it("never seeds an unpublished shop (its reads need a preview token a layout cannot see)", () => {
    expect(buildShopInitialData("s", shop(false), theme, outlets)).toBeUndefined();
  });

  it("withholds the seed when either fetch failed, so the client fetches as it always did", () => {
    expect(buildShopInitialData("s", shop(true), undefined, outlets)).toBeUndefined();
    expect(buildShopInitialData("s", shop(true), theme, undefined)).toBeUndefined();
  });
});
