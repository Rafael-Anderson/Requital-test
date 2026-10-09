import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getShop, getThemeConfig, HttpError, listOutlets, resolveImageUrl } from "@/lib/api";
import { buildShopInitialData, type ShopInitialData } from "@/lib/shop-initial-data";
import { resolveThemeVarsWithScheme } from "@/lib/theme-css-vars";
import { buildShopMetadata, canonicalUrlFor } from "@/lib/seo";
import { organizationJsonLd } from "@/lib/structured-data";
import JsonLd from "@/components/JsonLd";
import ShopLayoutClient from "./ShopLayoutClient";

// Server Component specifically so this can export generateMetadata for
// per-tenant title/favicon — ShopLayoutClient (hooks/context) can't, since
// "use client" components can't export generateMetadata. The shop, theme and
// outlets fetched here are also handed to ShopProvider as its initial data
// (lib/shop-initial-data.ts), so the server HTML carries the shop's real chrome
// and content instead of a loading skeleton. Every fetch is a plain uncached
// GET, so a shop or theme edit shows on the very next request; Next only
// memoizes identical GETs inside one render pass (this layout, generateMetadata
// and notFoundIfMissing's probe share one getShop call).
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
  // Organization markup for the shop itself, emitted once at the root so it
  // covers every page below it. Built from the same getShop() the metadata
  // block above already fetched (Next memoizes it within the request).
  let organization: ReturnType<typeof organizationJsonLd> | null = null;
  let initialData: ShopInitialData | undefined;
  try {
    // Both are cheap public GETs; fetch in parallel. The theme config is
    // needed here too (not just client-side) so the pre-paint vars carry the
    // published Sections theme's scheme colours + its legacy-path CTA / font
    // remap — otherwise a themed shop's primary buttons (and every bg-accent
    // element) flash the legacy colour on cold load before hydration.
    const [shop, themeConfig, outlets] = await Promise.all([
      getShop(shopSlug),
      // undefined = the fetch failed (initial data is then withheld); a successful
      // "no published theme" answer is null.
      getThemeConfig(shopSlug, { preview: false }).catch(() => undefined),
      listOutlets(shopSlug).catch(() => undefined),
    ]);
    initialData = buildShopInitialData(shopSlug, shop, themeConfig, outlets);
    themeVars = Object.entries(resolveThemeVarsWithScheme(shop, themeConfig ?? null))
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
    const url = canonicalUrlFor(shop, "/");
    if (url) organization = organizationJsonLd(shop, { url });
  } catch (err) {
    // A definite 404 (unknown slug, or a suspended shop, which the API answers
    // identically on purpose) becomes a real 404 here, before anything streams.
    if (err instanceof HttpError && err.status === 404) notFound();
    // Unreachable shop (backend blip) — the client renders the real error
    // state; a missing pre-paint style block just means the light default.
  }

  return (
    <>
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      {organization && <JsonLd data={organization} />}
      {/* key: a different shop must remount the provider, never reuse the previous shop's seeded state */}
      <ShopLayoutClient key={shopSlug} initialData={initialData}>
        {children}
      </ShopLayoutClient>
    </>
  );
}
