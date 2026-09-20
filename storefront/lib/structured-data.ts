import type { Product, Shop } from "./types";
import { resolveImageUrl } from "./api";

// JSON-LD builders, kept pure so the shapes are testable without rendering a
// route (same reasoning as lib/seo.ts's metadata builders next door).
//
// Deliberately NOT emitted: AggregateRating and Review. This app has no
// product review feature, so any rating here would be fabricated - which is
// both a Google structured-data policy violation and a lie to shoppers. Add
// them when reviews exist, not before.

export interface JsonLdObject {
  "@context": "https://schema.org";
  [key: string]: unknown;
}

function shopName(shop: Pick<Shop, "name" | "displayName">): string {
  return shop.displayName ?? shop.name;
}

// schema.org/ItemAvailability. `stockQuantity: null` means no outlet context
// or untracked inventory - not "out of stock", so it stays InStock.
function availability(product: Pick<Product, "status" | "stockQuantity">): string {
  if (product.status !== "Available") return "https://schema.org/OutOfStock";
  if (product.stockQuantity !== null && product.stockQuantity <= 0) {
    return "https://schema.org/OutOfStock";
  }
  return "https://schema.org/InStock";
}

// Product + a single nested Offer. The price is the one actually charged, so
// the caller passes the auto-discounted price when there is one - a Product
// snippet advertising a price the checkout will not honour is the exact
// mis-pricing class DSC-1 was about, just aimed at search results instead.
export function productJsonLd(
  product: Product,
  shop: Pick<Shop, "name" | "displayName" | "currency">,
  options: { url: string; price: number },
): JsonLdObject {
  const images = [product.thumbnail, ...product.images.map((i) => i.url)]
    .map((i) => resolveImageUrl(i))
    .filter((i): i is string => !!i);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    ...(product.description ? { description: stripTags(product.description) } : {}),
    ...(images.length > 0 ? { image: [...new Set(images)] } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.brand ? { brand: { "@type": "Brand", name: product.brand.name } } : {}),
    offers: {
      "@type": "Offer",
      url: options.url,
      price: options.price.toFixed(2),
      priceCurrency: shop.currency,
      availability: availability(product),
      seller: { "@type": "Organization", name: shopName(shop) },
    },
  };
}

// One Organization per shop, on the storefront root. `sameAs` is the
// schema.org property for "other authoritative profiles of this entity",
// which is exactly what the merchant's own social links are.
export function organizationJsonLd(
  shop: Pick<Shop, "name" | "displayName" | "logoUrl" | "socialLinks">,
  options: { url: string },
): JsonLdObject {
  const logo = resolveImageUrl(shop.logoUrl);
  const sameAs = Object.values(shop.socialLinks ?? {})
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.startsWith("http"));

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: shopName(shop),
    url: options.url,
    ...(logo ? { logo } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

// Mirrors the visible breadcrumb the PDP and collection pages already render
// (Home / Collection / Product). Built from the same items, so the markup and
// the structured data cannot drift apart into two different trails.
export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Product descriptions are rich-text HTML (see sanitize-html.ts). schema.org
// description wants plain text, and leaving tags in produces a snippet full
// of markup.
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
