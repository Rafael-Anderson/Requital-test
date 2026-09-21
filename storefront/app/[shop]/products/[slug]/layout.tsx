import type { Metadata } from "next";
import type { Product } from "@/lib/types";
import {
  getProduct,
  getProductBySlug,
  getShop,
  listActiveAutoDiscounts,
  listCollections,
} from "@/lib/api";
import { buildProductMetadata, canonicalUrlFor } from "@/lib/seo";
import { breadcrumbJsonLd, productJsonLd } from "@/lib/structured-data";
import { computeAutoDiscountedPrice } from "@/lib/auto-discounts";
import JsonLd from "@/components/JsonLd";

// Server Component so this can export generateMetadata — same split as
// [shop]/layout.tsx/ShopLayoutClient.tsx (the actual page below is "use
// client" for the interactive add-to-cart/zoom UI, which can't export
// generateMetadata itself).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string; slug: string }>;
}): Promise<Metadata> {
  const { shop: shopSlug, slug } = await params;
  try {
    // A numeric segment is the legacy id route (page.tsx redirects it to
    // the canonical slug URL) — resolve it the same way so the metadata
    // isn't just "Product" for the split second before the redirect fires.
    const product = /^\d+$/.test(slug)
      ? await getProduct(shopSlug, Number(slug))
      : await getProductBySlug(shopSlug, slug);
    // The shop carries the canonical origin and currency the price tags
    // need; a failure here must not lose the title/description that used
    // to work without it.
    const shop = await getShop(shopSlug).catch(() => null);
    return shop
      ? buildProductMetadata(product, shop, {
          price: await chargedPrice(shopSlug, product),
        })
      : buildProductMetadata(product);
  } catch {
    // Unknown/unavailable slug — the page body renders its own "not found"
    // state; metadata just falls back rather than failing the whole render.
    return { title: "Product" };
  }
}

// The price a shopper is actually charged, auto-discount included - the same
// number ProductCard and the PDP display (lib/auto-discounts.ts mirrors the
// server's own math). Advertising the undiscounted catalog price in a
// Product snippet or a link preview is the DSC-1 mis-pricing class again,
// just pointed at search results.
async function chargedPrice(shopSlug: string, product: Product): Promise<number> {
  const autoDiscounts = await listActiveAutoDiscounts(shopSlug).catch(() => []);
  return (
    computeAutoDiscountedPrice(product, autoDiscounts)?.discountedPrice ??
    Number(product.price)
  );
}

export default async function ProductLayout({
  params,
  children,
}: {
  params: Promise<{ shop: string; slug: string }>;
  children: React.ReactNode;
}) {
  const { shop: shopSlug, slug } = await params;
  const jsonLd = await productStructuredData(shopSlug, slug);
  return (
    <>
      {jsonLd.map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      {children}
    </>
  );
}

// Mirrors the visible breadcrumb ProductDetailClient renders (Home /
// primary collection / product) so the markup and the structured data
// cannot describe two different trails. Returns [] on any failure - missing
// structured data is a non-event, a thrown layout is a blank page.
async function productStructuredData(shopSlug: string, slug: string) {
  try {
    const [product, shop] = await Promise.all([
      /^\d+$/.test(slug)
        ? getProduct(shopSlug, Number(slug))
        : getProductBySlug(shopSlug, slug),
      getShop(shopSlug),
    ]);
    const url = canonicalUrlFor(shop, `/products/${product.slug}`);
    const home = canonicalUrlFor(shop, "/");
    if (!url || !home) return [];

    const trail = [{ name: "Home", url: home }];
    const primary = product.collections[0];
    if (primary) {
      const collections = await listCollections(shopSlug).catch(() => []);
      const match = collections.find((c) => c.id === primary.id);
      const collectionUrl =
        match && canonicalUrlFor(shop, `/collections/${match.slug}`);
      if (match && collectionUrl) {
        trail.push({ name: match.name, url: collectionUrl });
      }
    }
    trail.push({ name: product.name, url });

    return [
      productJsonLd(product, shop, {
        url,
        price: await chargedPrice(shopSlug, product),
      }),
      breadcrumbJsonLd(trail),
    ];
  } catch {
    return [];
  }
}
