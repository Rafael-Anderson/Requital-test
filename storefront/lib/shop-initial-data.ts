import type { Outlet, Shop } from "./types";
import type { ThemeConfig } from "./theme-config-types";

// What the Server Component layout (app/[shop]/layout.tsx) already fetched for
// the pre-paint CSS and the metadata, handed to ShopProvider so the very first
// render (server HTML and hydration alike) has the shop instead of a loading
// skeleton. Plain JSON on purpose: it crosses the server/client boundary as a
// prop. ShopProvider treats it as the starting state only; it never replaces a
// preview session's own fetches (see shop-context.tsx).
export interface ShopInitialData {
  shopSlug: string;
  shop: Shop;
  outlets: Outlet[];
  // null = "this shop has no published Sections theme" (a real answer, the legacy
  // layout renders), never "unknown": an unknown theme makes the whole bundle undefined.
  themeConfig: ThemeConfig | null;
}

// Pure so it can be unit-tested without a server. `undefined` for a part means
// that fetch failed; ShopProvider then falls back to its own client fetch and
// the page renders the loading skeleton on the server, exactly as before.
//
// An UNPUBLISHED shop never seeds: its outlets/menu/products are readable only
// with a staff previewToken, which a layout cannot see (layouts get no
// searchParams), so a seed would be incomplete and would put the "coming soon"
// state ahead of the theme builder's preview session.
export function buildShopInitialData(
  shopSlug: string,
  shop: Shop,
  themeConfig: ThemeConfig | null | undefined,
  outlets: Outlet[] | undefined,
): ShopInitialData | undefined {
  if (!shop.published) return undefined;
  if (themeConfig === undefined || outlets === undefined) return undefined;
  return { shopSlug, shop, outlets, themeConfig };
}
