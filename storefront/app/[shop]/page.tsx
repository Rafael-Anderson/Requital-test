"use client";

import { Suspense, useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listCollections, listProducts } from "@/lib/api";
import type { Collection, HomepageLayout, Product } from "@/lib/types";
import TrustStrip from "@/components/TrustStrip";
import CollectionShowcase from "@/components/CollectionShowcase";
import TemplateSections from "@/components/home-layouts/TemplateSections";
import ClassicHero from "@/components/home-layouts/ClassicHero";
import SlideshowHero, { type BannerImageInput } from "@/components/home-layouts/SlideshowHero";
import FeaturedGrid from "@/components/home-layouts/FeaturedGrid";
import GridFirstHero from "@/components/home-layouts/GridFirstHero";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// The Home tab's hero, always shown — collection browsing lives on its own
// real /collections/[slug] pages now, so there's no "filtered view" here to
// hide it from. Dispatches on shop.homepageLayout (Advanced tab); "custom"
// (reserved for a future drag-and-drop builder, not selectable in admin
// yet) falls back to Classic rather than rendering nothing, in case it's
// ever set directly some other way — same "never render broken/unstyled"
// rule as everywhere else in Theme.
function HomepageTop({
  shopSlug,
  layout,
  bannerUrl,
  banners,
  heroText,
  products,
  collections,
}: {
  shopSlug: string;
  layout: HomepageLayout;
  bannerUrl: string | null;
  banners: BannerImageInput[];
  heroText: string | null;
  products: Product[];
  collections: Collection[];
}) {
  if (layout === "slideshow") {
    return <SlideshowHero banners={banners} heroText={heroText} products={products} />;
  }
  if (layout === "featured_grid") {
    return <FeaturedGrid shopSlug={shopSlug} bannerUrl={bannerUrl} heroText={heroText} collections={collections} />;
  }
  if (layout === "grid_first") {
    return <GridFirstHero heroText={heroText} />;
  }
  return <ClassicHero bannerUrl={bannerUrl} heroText={heroText} />;
}

function HomeContent() {
  const { shopSlug, shop, outlets, loading: shopLoading, error: shopError } = useShop();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);

  // Stock is per-outlet — for browsing, before the customer has picked a
  // fulfillment method, we show stock against the shop's first outlet as a
  // reasonable default (most shops have exactly one). Multi-outlet shops
  // get an accurate re-check once an outlet is actually chosen at checkout.
  const defaultOutletId = outlets[0]?.id;
  const layout = shop?.homepageLayout ?? "classic";
  const homeTabMode = shop?.homeTabMode ?? "templates";

  // Unfiltered — collection filtering now lives on its own real
  // /collections/[slug] pages (see CollectionNav/CollectionShowcase),
  // fetched here only for the hero components that want a product-thumbnail
  // fallback (SlideshowHero) or the featured_grid tile set (FeaturedGrid).
  useEffect(() => {
    if (shopLoading) return;
    listProducts(shopSlug, defaultOutletId)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [shopSlug, defaultOutletId, shopLoading]);

  // Featured Grid needs collections for its own tile set; 'collections'
  // Home tab mode needs them for CollectionShowcase, which fetches its own
  // copy independently either way (same "components fetch what they need"
  // pattern used throughout this app) — this effect only covers Featured
  // Grid's need.
  useEffect(() => {
    if (shopLoading || layout !== "featured_grid") return;
    listCollections(shopSlug)
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [shopSlug, layout, shopLoading]);

  if (shopError) return <p className="text-red-600">{shopError}</p>;
  if (shopLoading || products === null) return <p className="text-zinc-500">Loading…</p>;

  // Only "classic" and "slideshow" are a genuine image/banner hero — those
  // render full-bleed, edge to edge, outside the page's own width cap (see
  // StorefrontPageShell). "featured_grid"'s collection-tile grid and
  // "grid_first"'s plain title bar read better contained at page width, so
  // HomepageTop for those two stays inside the shell below instead — same
  // component, same props, just placed in a different spot. 'custom' falls
  // back to ClassicHero internally (see HomepageTop), so it gets the same
  // full-bleed treatment as 'classic' since that's genuinely what renders.
  const fullBleedHero = layout === "classic" || layout === "slideshow" || layout === "custom";
  const heroNode = (
    <HomepageTop
      shopSlug={shopSlug}
      layout={layout}
      bannerUrl={shop?.bannerUrl ?? null}
      banners={shop?.banners ?? []}
      heroText={shop?.heroText ?? null}
      products={products}
      collections={collections}
    />
  );

  return (
    <>
      {fullBleedHero && heroNode}
      <StorefrontPageShell variant="wide">
        {!fullBleedHero && heroNode}
        {/* Anchor target for the fallback hero's "Shop now" CTA (see
            ClassicHero.tsx) — harmless no-op on every other layout/state. */}
        <div id="shop" />
      </StorefrontPageShell>
      {/* Full-bleed (own border-y spans edge to edge), not nested inside
          the shell above — TrustStrip manages its own contained inner row,
          same "full-width band, contained content" pattern as the hero.
          See TrustStrip.tsx and the storefront layout-bugs report. */}
      <TrustStrip />
      <StorefrontPageShell variant="wide">
        {homeTabMode === "collections" ? <CollectionShowcase /> : <TemplateSections />}
      </StorefrontPageShell>
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <HomeContent />
    </Suspense>
  );
}
