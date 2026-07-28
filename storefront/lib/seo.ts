import type { Metadata } from "next";
import type { BioPageConfig, Product, Shop } from "./types";
import { resolveImageUrl } from "./api";

// Pulled out as pure functions (rather than inlined in the two
// generateMetadata call sites — [shop]/layout.tsx and
// [shop]/products/[slug]/layout.tsx) so the title/description/OG-image
// fallback chains are directly testable without rendering a route.

// Product-level metaTitle/metaDescription are already fallback-resolved
// server-side (see backend PublicService.toProductResponse) — this just
// shapes them into Next's Metadata format, including the OG image WhatsApp
// and other link-preview surfaces need to render anything at all.
export function buildProductMetadata(product: Product): Metadata {
  const image = resolveImageUrl(product.thumbnail);
  return {
    title: product.metaTitle,
    description: product.metaDescription ?? undefined,
    openGraph: {
      title: product.metaTitle,
      description: product.metaDescription ?? undefined,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

// Shop-level fields have no server-side fallback (unlike product), since
// getShop() is also used to drive the live UI, not just metadata — the
// fallback chain lives here instead: an explicit SEO title/description
// wins, then the shop's own display name/description, so a merchant who's
// never touched the SEO tab still gets a real (not blank) title and OG
// image (ogImage itself is already resolved server-side against Theme's
// banner/logo, see PublicService.getShop).
export function buildShopMetadata(shop: Shop): Metadata {
  const title = shop.metaTitle ?? shop.displayName ?? shop.name;
  const description = shop.metaDescription ?? shop.description ?? undefined;
  const image = resolveImageUrl(shop.ogImage);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

// Same "fallback lives here, not server-side" reasoning as buildShopMetadata
// — extends its exact chain by one more link: bio-specific meta wins, then
// the shop's already-resolved general SEO meta/name (buildShopMetadata's own
// chain), so a merchant who's never touched the bio page's own meta fields
// still gets the same real title/description their storefront already has,
// never blank. Falls back to the shop's ogImage for the OG image too — the
// bio page's own logo isn't really an "og:image"-shaped asset (usually a
// square avatar, not a link-preview banner), so this deliberately doesn't
// try to repurpose bioPageConfig.logoUrl for that.
export function buildBioPageMetadata(shop: Shop, config: BioPageConfig): Metadata {
  const title = config.metaTitle ?? shop.metaTitle ?? shop.displayName ?? shop.name;
  const description = config.metaDescription ?? shop.metaDescription ?? shop.description ?? undefined;
  const image = resolveImageUrl(shop.ogImage);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}
