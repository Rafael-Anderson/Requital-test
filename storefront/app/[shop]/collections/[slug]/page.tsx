"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { getCollectionBySlug, resolveImageUrl } from "@/lib/api";
import type { CollectionDetail } from "@/lib/types";
import ProductCard from "@/components/ProductCard";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import StorefrontLoadingSkeleton from "@/components/StorefrontLoadingSkeleton";
import StorefrontErrorState from "@/components/StorefrontErrorState";

// Collection (taxonomy node) detail — /[shop]/collections/[slug]. Repurposed
// from the pre-Phase-C curated-list detail that used to live at this same
// URL (now served by /[shop]'s Template homepage sections + getTemplate
// instead — see lib/api.ts).
export default function CollectionPage() {
  const params = useParams<{ shop: string; slug: string }>();
  const { shopSlug, shop, outlets, loading: shopLoading, error: shopError } = useShop();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaultOutletId = outlets[0]?.id;

  useEffect(() => {
    if (shopLoading) return;
    getCollectionBySlug(shopSlug, params.slug, defaultOutletId)
      .then(setCollection)
      .catch((err) => setError(err instanceof Error ? err.message : "Collection not found"));
  }, [shopSlug, params.slug, defaultOutletId, shopLoading]);

  if (shopError) return <StorefrontErrorState variant="error" />;
  if (error) return <p className="text-red-600">{error}</p>;
  if (shopLoading || collection === null) return <StorefrontLoadingSkeleton />;

  const orientation = shop?.productDisplayOrientation ?? "grid";
  const bannerImage = resolveImageUrl(collection.image);

  return (
    <>
      {/* Full-bleed, same treatment as the homepage hero (see
          components/home-layouts/ClassicHero.tsx) — a collection banner is
          the same kind of brand/editorial moment, not page content. */}
      {bannerImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bannerImage} alt="" className="w-full aspect-[3/1] sm:aspect-[4/1] object-cover" />
      )}
      <StorefrontPageShell variant="wide">
        <h1 className="text-2xl font-semibold mb-4">{collection.name}</h1>

        {collection.products.length === 0 ? (
          <p className="text-zinc-500">No products in this collection yet.</p>
        ) : orientation === "list" ? (
          <div className="max-w-2xl">
            {collection.products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="list" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
            {collection.products.map((p) => (
              <ProductCard key={p.id} product={p} orientation="grid" />
            ))}
          </div>
        )}
      </StorefrontPageShell>
    </>
  );
}
