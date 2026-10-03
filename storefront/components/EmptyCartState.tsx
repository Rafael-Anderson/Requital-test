"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { listCollections, listProducts } from "@/lib/api";
import { storeButtonClassName } from "@/lib/button-style";
import { iconStyleProps } from "@/lib/icon-style";
import type { Collection, Product } from "@/lib/types";
import ProductCard from "@/components/ProductCard";

const MAX_COLLECTIONS = 6;
const MAX_PRODUCTS = 4;

// Top-level collections only; the merchant's featured ones first. Pure so the
// choice is unit-testable.
export function pickSuggestedCollections(all: Collection[]): Collection[] {
  const top = all.filter((c) => c.parentCollectionId === null);
  return [...top.filter((c) => c.isFeatured), ...top.filter((c) => !c.isFeatured)].slice(0, MAX_COLLECTIONS);
}

const skeletonBlock = { background: "color-mix(in srgb, var(--color-header-fg, #171717) 12%, transparent)" };

// Secondary content under the empty-cart message. Renders nothing at all until
// the two public reads settle, except a skeleton with the same footprint as the
// final layout, so the content above never moves; if the shop has neither
// collections nor products the block simply disappears.
function EmptyCartSuggestions() {
  const { shopSlug, shopBasePath } = useShop();
  const [data, setData] = useState<{ collections: Collection[]; products: Product[] } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      listCollections(shopSlug).catch(() => [] as Collection[]),
      listProducts(shopSlug).catch(() => [] as Product[]),
    ]).then(([collections, products]) => {
      if (live) setData({ collections: pickSuggestedCollections(collections), products: products.slice(0, MAX_PRODUCTS) });
    });
    return () => {
      live = false;
    };
  }, [shopSlug]);

  if (data && data.collections.length === 0 && data.products.length === 0) return null;

  if (!data) {
    return (
      <div aria-hidden="true" data-testid="empty-cart-skeleton" className="mt-12 w-full">
        <div className="flex flex-wrap justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 w-24 rounded-full animate-pulse" style={skeletonBlock} />
          ))}
        </div>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-9">
          {Array.from({ length: MAX_PRODUCTS }, (_, i) => (
            <div key={i}>
              <div className="aspect-square w-full rounded-lg animate-pulse" style={skeletonBlock} />
              <div className="mt-3 h-4 w-3/4 rounded animate-pulse" style={skeletonBlock} />
              <div className="mt-2 h-4 w-1/3 rounded animate-pulse" style={skeletonBlock} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-12 w-full">
      {data.collections.length > 0 && (
        <nav aria-label="Shop by collection" className="flex flex-wrap justify-center gap-2">
          {data.collections.map((c) => (
            <Link
              key={c.id}
              href={`${shopBasePath}/collections/${c.slug}`}
              className="inline-flex items-center h-9 px-4 rounded-full border border-stroke text-sm hover:border-accent hover:text-accent-text transition-colors"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {data.products.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-5 text-start">You might like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-9 text-start">
            {data.products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="grid" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The one empty-cart state for the cart page, the checkout page and the cart
// drawer. "page" adds the collections and product suggestions; "drawer" is the
// compact form (icon, message, one button) and closes the drawer instead of
// navigating, since the shopper is already on a shop page.
export default function EmptyCartState({ variant = "page", onContinue }: { variant?: "page" | "drawer"; onContinue?: () => void }) {
  const { shop, shopBasePath } = useShop();
  const compact = variant === "drawer";
  const button = `inline-flex items-center justify-center h-11 px-6 font-medium ${storeButtonClassName(shop)}`;

  return (
    <div className={compact ? "w-full" : "w-full py-6 sm:py-10"} data-testid="empty-cart">
      <div className={`flex flex-col items-center text-center ${compact ? "px-4 gap-3" : "gap-4"}`}>
        <span
          className={`flex items-center justify-center rounded-full ${compact ? "size-14" : "size-20"}`}
          style={{ background: "color-mix(in srgb, var(--color-accent) 10%, var(--background))" }}
        >
          <ShoppingBag className={`${compact ? "size-6" : "size-9"} text-accent-text`} {...iconStyleProps(shop?.iconStyle, 1.5)} aria-hidden="true" />
        </span>
        {compact ? (
          <h3 className="text-lg font-semibold">Your cart is empty</h3>
        ) : (
          <h1 className="text-2xl font-semibold">Your cart is empty</h1>
        )}
        <p className="text-foreground/60 max-w-sm">Add something you love and it will show up here.</p>
        {onContinue ? (
          <button type="button" onClick={onContinue} className={button}>
            Continue shopping
          </button>
        ) : (
          <Link href={shopBasePath || "/"} className={button}>
            Continue shopping
          </Link>
        )}
      </div>
      {!compact && <EmptyCartSuggestions />}
    </div>
  );
}
