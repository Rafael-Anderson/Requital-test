"use client";

import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { stripHtmlToText } from "@/lib/sanitize-html";
import { productCardNameStyle } from "@/lib/theme-element-style";
import { resolveProductBadge } from "@/lib/product-badge";
import { computeAutoDiscountedPrice } from "@/lib/auto-discounts";
import CurrencySymbol from "@/components/CurrencySymbol";
import { useProductCardImageIndex } from "@/lib/use-product-card-image-index";
import type { Product } from "@/lib/types";

// Struck-through original + discounted price, shared by the grid and list
// card layouts below — an active auto discount needs zero customer action
// to show up here (see lib/auto-discounts.ts).
function PriceDisplay({ product, currency, discounted }: { product: Product; currency: string | undefined; discounted: ReturnType<typeof computeAutoDiscountedPrice> }) {
  if (!discounted) {
    return (
      <>
        {product.price} <span className="font-normal text-price-main"><CurrencySymbol code={currency} /></span>
      </>
    );
  }
  return (
    <>
      <span className="line-through text-price-main font-normal mr-1.5">
        {discounted.originalPrice} <CurrencySymbol code={currency} />
      </span>
      <span className="text-red-600">
        {discounted.discountedPrice} <span className="font-normal"><CurrencySymbol code={currency} /></span>
      </span>
    </>
  );
}

// shortSummary is the field meant for exactly this (a one-liner, plain
// text) — description is rich-text HTML meant for the PDP body, only used
// here as a fallback so a card excerpt still has *something* rather than
// silently showing nothing when a merchant filled in the long description
// but never touched the short one.
function cardExcerpt(product: Product): string | null {
  if (product.shortSummary) return product.shortSummary;
  if (product.description) return stripHtmlToText(product.description);
  return null;
}

export default function ProductCard({ product, orientation }: { product: Product; orientation: "grid" | "list" }) {
  const { shop, shopBasePath, themeConfig, autoDiscounts = [] } = useShop();
  const discounted = computeAutoDiscountedPrice(product, autoDiscounts);
  const outOfStock = product.stockQuantity !== null && product.stockQuantity <= 0;
  const excerpt = cardExcerpt(product);
  const productCards = themeConfig?.globalSettings.productCards;
  const cardHoverEffect = themeConfig?.globalSettings.animations.cardHoverEffect;
  // globalSettings.badges wiring (Phase 1) — sold-out wins over sale. null
  // for an un-themed shop (no themeConfig ⇒ no badges), where the legacy
  // "Out of stock" pill still renders below.
  const badge =
    (outOfStock ? resolveProductBadge("sold_out", themeConfig?.globalSettings.badges, themeConfig?.globalSettings.colorSchemes) : null) ||
    (discounted ? resolveProductBadge("sale", themeConfig?.globalSettings.badges, themeConfig?.globalSettings.colorSchemes) : null);
  const images = product.images.length > 0 ? product.images.map((i) => i.url) : [product.thumbnail];
  const { activeIndex, handlers } = useProductCardImageIndex(images.length, {
    cycle: !!productCards?.showCarousel,
    swapOnHover: cardHoverEffect === "swap",
  });
  const nameStyle = productCards ? productCardNameStyle(productCards) : undefined;

  if (orientation === "list") {
    return (
      <Link
        href={`${shopBasePath}/products/${product.slug}`}
        className="flex gap-4 items-center border-b border-stroke py-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={product.thumbnail} alt={product.name} className="size-20 rounded-lg object-cover shrink-0 bg-black/5" />
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate text-product-name" style={nameStyle} title={product.name}>{product.name}</p>
          {product.shortSummary && <p className="text-sm text-price-main truncate">{product.shortSummary}</p>}
          <p className="text-sm font-semibold mt-1 text-product-name">
            <PriceDisplay product={product} currency={shop?.currency} discounted={discounted} />
          </p>
          {outOfStock && <p className="text-xs text-red-600 mt-0.5">Out of stock</p>}
        </div>
      </Link>
    );
  }

  return (
    <Link href={`${shopBasePath}/products/${product.slug}`} className="theme-product-card block group transition-all" {...handlers}>
      <div className="aspect-square rounded-xl overflow-hidden bg-black/5 relative shadow-sm shadow-black/5 group-hover:shadow-lg group-hover:shadow-black/10 transition-shadow duration-300">
        {images.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={url}
            alt={product.name}
            className="theme-product-image absolute inset-0 w-full h-full object-cover transition-opacity duration-150"
            style={{ opacity: i === activeIndex ? 1 : 0 }}
          />
        ))}
        {badge ? (
          <span className={`absolute ${badge.positionClass} px-2 py-0.5 text-xs font-medium`} style={badge.style}>
            {badge.label}
          </span>
        ) : outOfStock ? (
          <span className="absolute top-2 right-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium text-red-600">
            Out of stock
          </span>
        ) : null}
      </div>
      {/* Single-line ellipsis so long bouquet/gift names never wrap and break
          card-row alignment across a grid; full name available on hover. */}
      <p className="mt-3 text-[15px] leading-snug truncate text-product-name" style={nameStyle} title={product.name}>{product.name}</p>
      <p className="text-sm font-semibold mt-1 text-product-name">
        <PriceDisplay product={product} currency={shop?.currency} discounted={discounted} />
      </p>
      {productCards?.showProductDescriptions && excerpt && (
        <p className="mt-1 text-xs leading-snug line-clamp-2 text-price-main">{excerpt}</p>
      )}
    </Link>
  );
}
