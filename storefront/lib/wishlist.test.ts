import { afterEach, describe, expect, it } from "vitest";
import {
  WISHLIST_MAX,
  mergeWishlists,
  readLocalWishlist,
  toggleInList,
  wishlistEnabled,
  writeLocalWishlist,
} from "./wishlist";
import type { ThemeConfig } from "./theme-config-types";

afterEach(() => {
  localStorage.clear();
});

describe("wishlistEnabled", () => {
  it("is false for a missing themeConfig / missing productCards / explicit false", () => {
    expect(wishlistEnabled(null)).toBe(false);
    expect(wishlistEnabled(undefined)).toBe(false);
    expect(wishlistEnabled({ globalSettings: {} } as unknown as ThemeConfig)).toBe(false);
    expect(
      wishlistEnabled({
        globalSettings: { productCards: { showWishlist: false } },
      } as unknown as ThemeConfig),
    ).toBe(false);
  });

  it("is true only when showWishlist is exactly true", () => {
    expect(
      wishlistEnabled({
        globalSettings: { productCards: { showWishlist: true } },
      } as unknown as ThemeConfig),
    ).toBe(true);
  });
});

describe("readLocalWishlist / writeLocalWishlist", () => {
  it("round-trips an id array per shop slug", () => {
    writeLocalWishlist("shop-a", [3, 1, 2]);
    expect(readLocalWishlist("shop-a")).toEqual([3, 1, 2]);
    expect(readLocalWishlist("shop-b")).toEqual([]);
  });

  it("returns [] for corrupt or non-array stored JSON", () => {
    localStorage.setItem("requital_storefront_wishlist:shop-a", "not json");
    expect(readLocalWishlist("shop-a")).toEqual([]);
    localStorage.setItem("requital_storefront_wishlist:shop-a", '{"x":1}');
    expect(readLocalWishlist("shop-a")).toEqual([]);
  });

  it("drops non-positive-integer entries", () => {
    localStorage.setItem("requital_storefront_wishlist:shop-a", JSON.stringify([1, "2", 0, -3, 4.5, 5]));
    expect(readLocalWishlist("shop-a")).toEqual([1, 5]);
  });
});

describe("mergeWishlists (login union)", () => {
  it("keeps server order, appends local ids the server lacks", () => {
    expect(mergeWishlists([10, 20], [20, 30, 40])).toEqual([10, 20, 30, 40]);
  });

  it("is a no-op when local is empty or fully covered", () => {
    expect(mergeWishlists([1, 2, 3], [])).toEqual([1, 2, 3]);
    expect(mergeWishlists([1, 2, 3], [2, 1])).toEqual([1, 2, 3]);
  });

  it("caps at the max, dropping the merge tail (first-capped-wins)", () => {
    const server = Array.from({ length: WISHLIST_MAX - 1 }, (_, i) => i + 1);
    const merged = mergeWishlists(server, [500, 501, 502]);
    expect(merged).toHaveLength(WISHLIST_MAX);
    expect(merged[WISHLIST_MAX - 1]).toBe(500);
    expect(merged).not.toContain(501);
  });

  it("never exceeds the cap even if the server list is already over it", () => {
    const server = Array.from({ length: WISHLIST_MAX + 5 }, (_, i) => i + 1);
    expect(mergeWishlists(server, [999])).toHaveLength(WISHLIST_MAX);
  });
});

describe("toggleInList", () => {
  it("adds an absent id and removes a present one", () => {
    expect(toggleInList([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleInList([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("adding at the cap is a no-op (returns the same array reference)", () => {
    const full = Array.from({ length: WISHLIST_MAX }, (_, i) => i + 1);
    const result = toggleInList(full, 9999);
    expect(result).toBe(full);
  });

  it("removing at the cap still works", () => {
    const full = Array.from({ length: WISHLIST_MAX }, (_, i) => i + 1);
    expect(toggleInList(full, 1)).toHaveLength(WISHLIST_MAX - 1);
  });
});
