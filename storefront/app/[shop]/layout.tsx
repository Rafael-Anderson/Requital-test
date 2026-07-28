import type { Metadata } from "next";
import { getShop, resolveImageUrl } from "@/lib/api";
import { buildShopMetadata } from "@/lib/seo";
import ShopLayoutClient from "./ShopLayoutClient";

// Server Component specifically so this can export generateMetadata for
// per-tenant title/favicon — ShopLayoutClient (hooks/context) can't, since
// "use client" components can't export generateMetadata. Duplicates the
// getShop() fetch ShopProvider also makes client-side; accepted as cheap
// (see the research this task started from) rather than threading fetched
// data down as props, which would need restructuring the client provider.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string }>;
}): Promise<Metadata> {
  const { shop: shopSlug } = await params;
  try {
    const shop = await getShop(shopSlug);
    const favicon = resolveImageUrl(shop.faviconUrl);
    return {
      ...buildShopMetadata(shop),
      icons: favicon ? { icon: favicon } : undefined,
    };
  } catch {
    // Unknown shop slug — the page body itself renders the real 404/error
    // state; metadata just falls back to something reasonable rather than
    // failing the whole render.
    return { title: shopSlug };
  }
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopLayoutClient>{children}</ShopLayoutClient>;
}
