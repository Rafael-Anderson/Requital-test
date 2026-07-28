import type { Metadata } from "next";
import { getBioPageConfig, getShop } from "@/lib/api";
import { buildBioPageMetadata } from "@/lib/seo";

// Server Component so this can export its own generateMetadata — same split
// as [shop]/layout.tsx/ShopLayoutClient.tsx and
// [shop]/products/[slug]/layout.tsx/page.tsx (the actual bio page below is
// "use client" for the interactive click-through UI, which can't export
// generateMetadata itself).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string }>;
}): Promise<Metadata> {
  const { shop: shopSlug } = await params;
  try {
    const [shop, bioPageConfig] = await Promise.all([getShop(shopSlug), getBioPageConfig(shopSlug)]);
    return buildBioPageMetadata(shop, bioPageConfig);
  } catch {
    // Unknown/unpublished shop — the page body renders its own error/
    // "coming soon" state; metadata just falls back rather than failing the
    // whole render.
    return { title: "Bio" };
  }
}

export default function BioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
