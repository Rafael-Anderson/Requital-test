"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import { selectTiles } from "@/components/home-layouts/FeaturedGrid";
import type { Collection } from "@/lib/types";
import type { SectionSettings } from "@/lib/theme-config-types";

export default function FeaturedCollectionsSection({ settings }: { settings: SectionSettings }) {
  const { shopSlug, shopBasePath } = useShop();
  const [collections, setCollections] = useState<Collection[]>([]);
  const heading = typeof settings.heading === "string" ? settings.heading : "";

  useEffect(() => {
    listCollections(shopSlug)
      .then(setCollections)
      .catch(() => setCollections([]));
  }, [shopSlug]);

  const tiles = selectTiles(collections);
  if (tiles.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      {heading && <h2 className="text-xl font-semibold mb-4">{heading}</h2>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((c) => (
          <Link
            key={c.id}
            href={`${shopBasePath}/collections/${c.slug}`}
            className="group overflow-hidden border border-stroke"
            style={{ borderRadius: "var(--theme-radius, 8px)" }}
          >
            <div className="aspect-square bg-black/5 overflow-hidden">
              {c.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageUrl(c.image) ?? undefined}
                  alt=""
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs px-2 text-center">
                  {c.name}
                </div>
              )}
            </div>
            <p className="px-2 py-1.5 text-xs font-medium truncate">{c.name}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
