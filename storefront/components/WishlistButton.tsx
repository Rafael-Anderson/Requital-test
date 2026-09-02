"use client";

import { Heart } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useWishlist, wishlistEnabled } from "@/lib/wishlist";

// Rendered inside a product card's <Link> — every handler stops the click
// from navigating. The feature gate lives here (not at each call site) so
// ProductCard and GridProductCard just drop <WishlistButton productId> in.
export default function WishlistButton({ productId }: { productId: number }) {
  const { themeConfig, previewMode } = useShop();
  const { has, toggle } = useWishlist();

  if (!wishlistEnabled(themeConfig)) return null;

  const active = has(productId);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    // In the theme-builder preview the card isn't really shoppable — let the
    // click bubble so PreviewInteraction can select the section instead.
    if (previewMode) return;
    e.stopPropagation();
    toggle(productId);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "Remove from wishlist" : "Add to wishlist"}
      className="absolute top-2 left-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-background/90 text-product-name shadow-sm shadow-black/10 transition-colors hover:bg-background"
    >
      <Heart
        className={`h-4 w-4 ${active ? "fill-red-500 text-red-500" : ""}`}
        strokeWidth={2}
      />
    </button>
  );
}
