import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import WishlistButton from "./WishlistButton";

// Note: the "cleared on animationend" path (onAnimationEnd={() => setAdding(false)})
// can't be exercised here — jsdom doesn't wire animationend into React's event
// system. It's verified in the scratch-shop browser pass instead.

// §8.13.C item 4 — the one-shot animation class is applied on toggle-to-active
// and cleared on animationend. Everything else about the button is unchanged.

let wishlistAnimation: string | undefined;
let ids: number[] = [];
const toggle = vi.fn((id: number) => {
  ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
});

vi.mock("@/lib/shop-context", () => ({
  useShop: () => ({
    themeConfig: { globalSettings: { productCards: { showWishlist: true, wishlistAnimation } } },
    previewMode: false,
  }),
}));
vi.mock("@/lib/wishlist", () => ({
  wishlistEnabled: () => true,
  useWishlist: () => ({ has: (id: number) => ids.includes(id), toggle }),
}));

afterEach(() => {
  cleanup();
  wishlistAnimation = undefined;
  ids = [];
  toggle.mockClear();
});

describe("WishlistButton animation", () => {
  it("no-op: unset wishlistAnimation ⇒ no theme-wishlist-* class on add", () => {
    const { getByRole } = render(<WishlistButton productId={7} />);
    const btn = getByRole("button");
    fireEvent.click(btn);
    expect(btn.className).not.toMatch(/theme-wishlist-/);
  });

  it("pop ⇒ adds theme-wishlist-anim (only) when toggled ON", () => {
    wishlistAnimation = "pop";
    const { getByRole } = render(<WishlistButton productId={7} />);
    const btn = getByRole("button");
    fireEvent.click(btn);
    expect(btn.className).toContain("theme-wishlist-anim");
    expect(btn.className).not.toContain("theme-wishlist-anim-burst");
  });

  it("burst ⇒ adds both classes", () => {
    wishlistAnimation = "burst";
    const { getByRole } = render(<WishlistButton productId={7} />);
    fireEvent.click(getByRole("button"));
    expect(getByRole("button").className).toContain("theme-wishlist-anim-burst");
  });

  it("does not animate when toggled OFF (already active)", () => {
    wishlistAnimation = "pop";
    ids = [7];
    const { getByRole } = render(<WishlistButton productId={7} />);
    fireEvent.click(getByRole("button"));
    expect(getByRole("button").className).not.toMatch(/theme-wishlist-/);
  });

  it("sweep (reserved, unbuilt) ⇒ no class", () => {
    wishlistAnimation = "sweep";
    const { getByRole } = render(<WishlistButton productId={7} />);
    fireEvent.click(getByRole("button"));
    expect(getByRole("button").className).not.toMatch(/theme-wishlist-/);
  });
});
