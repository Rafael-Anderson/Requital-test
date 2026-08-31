import type { Metadata } from "next";
import { getShop, listBrands } from "@/lib/api";
import { buildBrandMetadata } from "@/lib/seo";

// Server Component so this can export generateMetadata — same split as
// [shop]/products/[slug]/layout.tsx (the page below is "use client" for its
// interactive sort UI). Brands have no slug column, so the route segment is
// the numeric brand id.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string; brandId: string }>;
}): Promise<Metadata> {
  const { shop: shopSlug, brandId } = await params;
  try {
    const [shop, brands] = await Promise.all([getShop(shopSlug), listBrands(shopSlug)]);
    const brand = brands.find((b) => b.id === Number(brandId));
    if (!brand) return { title: "Brand" };
    return buildBrandMetadata(shop, brand);
  } catch {
    return { title: "Brand" };
  }
}

export default function BrandLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
