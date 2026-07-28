import type { Metadata } from "next";
import { getProduct, getProductBySlug } from "@/lib/api";
import { buildProductMetadata } from "@/lib/seo";

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
    return buildProductMetadata(product);
  } catch {
    // Unknown/unavailable slug — the page body renders its own "not found"
    // state; metadata just falls back rather than failing the whole render.
    return { title: "Product" };
  }
}

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
