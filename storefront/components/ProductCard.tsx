"use client";

import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { stripHtmlToText } from "@/lib/sanitize-html";
import { productCardNameStyle } from "@/lib/theme-element-style";
import CurrencySymbol from "@/components/CurrencySymbol";
import { useProductCardImageIndex } from "@/lib/use-product-card-image-index";
import type { Product } from "@/lib/types";

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
  const { shop, shopBasePath, themeConfig } = useShop();
  const outOfStock = product.stockQuantity !== null && product.stockQuantity <= 0;
  const excerpt = cardExcerpt(product);
  const productCards = themeConfig?.globalSettings.productCards;
  const cardHoverEffect = themeConfig?.globalSettings.animations.cardHoverEffect;
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
          <p className="font-medium truncate text-product-name" style={nameStyle}>{product.name}</p>
          {product.shortSummary && <p className="text-sm text-zinc-500 truncate">{product.shortSummary}</p>}
          <p className="text-sm font-semibold mt-1 text-product-name">
            {product.price} <span className="font-normal text-price-main"><CurrencySymbol code={shop?.currency} /></span>
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
        {outOfStock && (
          <span className="absolute top-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-red-600">
            Out of stock
          </span>
        )}
      </div>
      {/* line-clamp-2 (Tailwind v4 core, no plugin) instead of the old
          single-line truncate — a bouquet/gift name running to two lines on
          mobile no longer gets silently chopped mid-word (see design audit). */}
      <p className="mt-3 text-[15px] leading-snug line-clamp-2 text-product-name" style={nameStyle}>{product.name}</p>
      <p className="text-sm font-semibold mt-1 text-product-name">
        {product.price} <span className="font-normal text-price-main"><CurrencySymbol code={shop?.currency} /></span>
      </p>
      {excerpt && <p className="mt-1 text-xs leading-snug line-clamp-2 text-price-main">{excerpt}</p>}
    </Link>
  );
}
