import type { Metadata } from "next";
import { getShop, HttpError, listBrands } from "@/lib/api";
import { buildBrandMetadata } from "@/lib/seo";
import RenderWhenShopLoaded from "@/components/RenderWhenShopLoaded";
import { notFoundIfMissing } from "@/lib/not-found-gate";

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

export default async function BrandLayout({
  params,
  children,
}: {
  params: Promise<{ shop: string; brandId: string }>;
  children: React.ReactNode;
}) {
  const { shop: shopSlug, brandId } = await params;
  // Brands have no by-id endpoint: the public list (brands with an Available
  // product, what the page itself looks the brand up in) is the existence test.
  await notFoundIfMissing(shopSlug, async () => {
    const brands = await listBrands(shopSlug);
    if (!brands.some((b) => b.id === Number(brandId))) throw new HttpError("Brand not found", 404);
  });
  return <RenderWhenShopLoaded>{children}</RenderWhenShopLoaded>;
}
