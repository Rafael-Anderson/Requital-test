import type { Metadata } from "next";
import type { BioPageConfig, Brand, Product, Shop } from "./types";
import { resolveImageUrl } from "./api";

// Pulled out as pure functions (rather than inlined in the two
// generateMetadata call sites — [shop]/layout.tsx and
// [shop]/products/[slug]/layout.tsx) so the title/description/OG-image
// fallback chains are directly testable without rendering a route.

// The same page is reachable at several hosts (the /{slug}/... path form,
// {subdomain}.requital.io, a verified custom domain) and with arbitrary query
// strings on top. `shop.canonicalOrigin` is resolved server-side into the one
// host this shop should be indexed under (backend public/canonical-origin.ts);
// `path` is the parameter-free path within it.
//
// Returns undefined when the origin is missing rather than guessing a host: a
// canonical pointing at the wrong origin is worse than none at all, because it
// actively tells crawlers to index a URL that may not serve this content.
export function canonicalUrlFor(
  shop: Pick<Shop, "canonicalOrigin">,
  path: string,
): string | undefined {
  if (!shop.canonicalOrigin) return undefined;
  const suffix = path === "/" ? "" : path;
  return `${shop.canonicalOrigin}${suffix}`;
}

// Product-level metaTitle/metaDescription are already fallback-resolved
// server-side (see backend PublicService.toProductResponse) — this just
// shapes them into Next's Metadata format, including the OG image WhatsApp
// and other link-preview surfaces need to render anything at all.
// `shop` is optional so the existing call shape keeps working for a page that
// cannot resolve the shop (the PDP's own catch branch); without it the result
// is exactly what it was before canonical/price tags existed.
//
// og:price:amount / og:price:currency have no typed home in Next's Metadata
// (its OpenGraphType union has no 'product'), so they go through `other`,
// which emits them as plain <meta property>. The price passed in is the one
// actually charged, auto-discount included - a link preview quoting a price
// checkout will not honour is the same class of mis-pricing as DSC-1.
export function buildProductMetadata(
  product: Product,
  shop?: Pick<Shop, "canonicalOrigin" | "currency">,
  options?: { price?: number },
): Metadata {
  const image = resolveImageUrl(product.thumbnail);
  const images = image ? [{ url: image }] : undefined;
  const canonical = shop
    ? canonicalUrlFor(shop, `/products/${product.slug}`)
    : undefined;
  const price = options?.price ?? Number(product.price);
  return {
    title: product.metaTitle,
    description: product.metaDescription ?? undefined,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title: product.metaTitle,
      description: product.metaDescription ?? undefined,
      images,
      ...(canonical ? { url: canonical } : {}),
      type: "website",
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: product.metaTitle,
      description: product.metaDescription ?? undefined,
      images: image ? [image] : undefined,
    },
    ...(shop?.currency && Number.isFinite(price)
      ? {
          other: {
            "product:price:amount": price.toFixed(2),
            "product:price:currency": shop.currency,
          },
        }
      : {}),
  };
}

// Collection pages had no generateMetadata at all before this - they
// inherited the shop-level title, so every collection shared one title and
// one canonical-less URL. No collection-level SEO fields exist in the data
// model, so the title/description are composed, same shape as
// buildBrandMetadata below.
export function buildCollectionMetadata(
  shop: Shop,
  collection: { name: string; slug: string; description?: string | null },
): Metadata {
  const name = shop.displayName ?? shop.name;
  const title = `${collection.name} | ${name}`;
  const description =
    collection.description ?? `Shop ${collection.name} at ${name}.`;
  const image = resolveImageUrl(shop.ogImage);
  const canonical = canonicalUrlFor(shop, `/collections/${collection.slug}`);
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
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
  const canonical = canonicalUrlFor(shop, "/");
  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
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
// Brand-filtered listing page (/[shop]/brands/[brandId]). No brand-level
// SEO fields exist, so the title/description are composed from the brand
// name + the shop's own resolved name, and the OG image falls back to the
// shop's — same "fallback lives here" shape as the helpers above.
export function buildBrandMetadata(shop: Shop, brand: Pick<Brand, "name">): Metadata {
  const shopName = shop.displayName ?? shop.name;
  const title = `${brand.name} | ${shopName}`;
  const description = `Shop ${brand.name} products at ${shopName}.`;
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
