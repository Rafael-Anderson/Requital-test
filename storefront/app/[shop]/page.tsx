"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { listCategories, listProducts } from "@/lib/api";
import type { Category, HomepageLayout, Product } from "@/lib/types";
import ProductCard from "@/components/ProductCard";
import TrustStrip from "@/components/TrustStrip";
import CategoryShowcase from "@/components/CategoryShowcase";
import ClassicHero from "@/components/home-layouts/ClassicHero";
import SlideshowHero, { type BannerImageInput } from "@/components/home-layouts/SlideshowHero";
import FeaturedGrid from "@/components/home-layouts/FeaturedGrid";
import GridFirstHero from "@/components/home-layouts/GridFirstHero";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// Only on the unfiltered "all products" view — repeating the hero section
// above every category listing would just be visual noise once a customer
// has already drilled in. Dispatches on shop.homepageLayout (Advanced tab);
// "custom" (reserved for a future drag-and-drop builder, not selectable in
// admin yet) falls back to Classic rather than rendering nothing, in case
// it's ever set directly some other way — same "never render broken/
// unstyled" rule as everywhere else in Theme.
function HomepageTop({
  shopSlug,
  layout,
  bannerUrl,
  banners,
  heroText,
  products,
  categories,
}: {
  shopSlug: string;
  layout: HomepageLayout;
  bannerUrl: string | null;
  banners: BannerImageInput[];
  heroText: string | null;
  products: Product[];
  categories: Category[];
}) {
  if (layout === "slideshow") {
    return <SlideshowHero banners={banners} heroText={heroText} products={products} />;
  }
  if (layout === "featured_grid") {
    return <FeaturedGrid shopSlug={shopSlug} bannerUrl={bannerUrl} heroText={heroText} categories={categories} />;
  }
  if (layout === "grid_first") {
    return <GridFirstHero heroText={heroText} />;
  }
  return <ClassicHero bannerUrl={bannerUrl} heroText={heroText} />;
}

function HomeContent() {
  const { shopSlug, shop, outlets, loading: shopLoading, error: shopError } = useShop();
  const searchParams = useSearchParams();
  const categoryId = searchParams.get("category");
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  // Stock is per-outlet — for browsing, before the customer has picked a
  // fulfillment method, we show stock against the shop's first outlet as a
  // reasonable default (most shops have exactly one). Multi-outlet shops
  // get an accurate re-check once an outlet is actually chosen at checkout.
  const defaultOutletId = outlets[0]?.id;
  const layout = shop?.homepageLayout ?? "classic";

  useEffect(() => {
    if (shopLoading) return;
    listProducts(shopSlug, defaultOutletId, categoryId ? Number(categoryId) : undefined)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [shopSlug, defaultOutletId, categoryId, shopLoading]);

  // Only Featured Grid needs categories on the homepage — CategoryNav (in
  // the header) fetches its own copy independently either way, same
  // "components fetch what they need" pattern used throughout this app.
  useEffect(() => {
    if (shopLoading || categoryId || layout !== "featured_grid") return;
    listCategories(shopSlug)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [shopSlug, categoryId, layout, shopLoading]);

  if (shopError) return <p className="text-red-600">{shopError}</p>;
  if (shopLoading || products === null) return <p className="text-zinc-500">Loading…</p>;

  // Only "classic" and "slideshow" are a genuine image/banner hero — those
  // render full-bleed, edge to edge, outside the page's own width cap (see
  // StorefrontPageShell). "featured_grid"'s category-tile grid and
  // "grid_first"'s plain title bar read better contained at page width, so
  // HomepageTop for those two stays inside the shell below instead — same
  // component, same props, just placed in a different spot. 'custom' falls
  // back to ClassicHero internally (see HomepageTop), so it gets the same
  // full-bleed treatment as 'classic' since that's genuinely what renders.
  const fullBleedHero = layout === "classic" || layout === "slideshow" || layout === "custom";
  const heroNode = !categoryId ? (
    <HomepageTop
      shopSlug={shopSlug}
      layout={layout}
      bannerUrl={shop?.bannerUrl ?? null}
      banners={shop?.banners ?? []}
      heroText={shop?.heroText ?? null}
      products={products}
      categories={categories}
    />
  ) : null;

  const orientation = shop?.productDisplayOrientation ?? "grid";

  return (
    <>
      {fullBleedHero && heroNode}
      <StorefrontPageShell variant="wide">
        {!fullBleedHero && heroNode}
        {!categoryId && <CategoryShowcase />}
      </StorefrontPageShell>
      {/* Full-bleed (own border-y spans edge to edge), not nested inside
          the shell above — TrustStrip manages its own contained inner row,
          same "full-width band, contained content" pattern as the hero.
          See TrustStrip.tsx and the storefront layout-bugs report. */}
      {!categoryId && <TrustStrip />}
      <StorefrontPageShell variant="wide">
        {/* Anchor target for the fallback hero's "Shop now" CTA (see
            ClassicHero.tsx) — harmless no-op on every other layout/state. */}
        <div id="shop" />
        {products.length === 0 ? (
          <p className="text-zinc-500">No products yet.</p>
        ) : orientation === "list" ? (
          <div className="max-w-2xl">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="list" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-9">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="grid" />
            ))}
          </div>
        )}
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
