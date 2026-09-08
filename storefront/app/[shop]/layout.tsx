import type { Metadata } from "next";
import { getShop, getThemeConfig, resolveImageUrl } from "@/lib/api";
import { resolveThemeVarsWithScheme } from "@/lib/theme-css-vars";
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

export default async function ShopLayout({
  params,
  children,
}: {
  params: Promise<{ shop: string }>;
  children: React.ReactNode;
}) {
  const { shop: shopSlug } = await params;

  // Pre-paint theme vars: the storefront is otherwise a fully client-rendered
  // SPA (ShopProvider fetches getShop() in a useEffect), so until that resolves
  // every :root color sits at the light globals.css default — a dark-themed
  // shop flashed a white StorefrontLoadingSkeleton on every cold load. Emitting
  // the resolved vars here means the first server paint already carries the
  // shop's real background/surface colors; ShopProvider re-applies the
  // identical values as inline <html> styles after mount (inline wins, so no
  // flicker). Same getShop() the metadata block above already fetched — Next
  // memoizes it within the request.
  let themeVars = "";
  try {
    // Both are cheap public GETs; fetch in parallel. The theme config is
    // needed here too (not just client-side) so the pre-paint vars carry the
    // published Sections theme's scheme colours + its legacy-path CTA / font
    // remap — otherwise a themed shop's primary buttons (and every bg-accent
    // element) flash the legacy colour on cold load before hydration.
    const [shop, themeConfig] = await Promise.all([
      getShop(shopSlug),
      getThemeConfig(shopSlug, { preview: false }).catch(() => null),
    ]);
    themeVars = Object.entries(resolveThemeVarsWithScheme(shop, themeConfig))
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  } catch {
    // Unknown/unreachable shop — the client renders the real error state; a
    // missing pre-paint style block just means the old light-default behavior.
  }

  return (
    <>
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      <ShopLayoutClient>{children}</ShopLayoutClient>
    </>
  );
}
