"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import type { Collection, CollectionsGridAspectRatio, CollectionsGridColumns, CollectionsGridGap } from "@/lib/types";

// Literal Tailwind class lookups, not string interpolation — Tailwind's
// build-time scanner only picks up classes that appear as whole literals in
// source, not ones assembled at runtime (e.g. `sm:grid-cols-${n}`).
const COLUMNS_CLASS: Record<CollectionsGridColumns, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};
const GAP_CLASS: Record<CollectionsGridGap, string> = {
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};
const ASPECT_CLASS: Record<CollectionsGridAspectRatio, string> = {
  square: "aspect-square",
  portrait: "aspect-[4/5]",
  landscape: "aspect-[16/9]",
};

// A homepage showcase row, distinct from components/CollectionNav.tsx (the
// header's compact text-pill filter bar) — this is a landing element in its
// own right: collection photography where set, sized to actually invite a
// click rather than a functional filter control. One of the highest-impact
// homepage elements for reducing bounce (a visitor who doesn't yet know
// what to search for still has somewhere obvious to go) — see the Phase 2
// design brief. Horizontal scroll on narrow screens, a real grid from sm up.
export default function CollectionShowcase() {
  const { shopSlug, shopBasePath, shop } = useShop();
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listCollections(shopSlug)
      .then((all) => setCollections(all.filter((c) => c.parentCollectionId === null)))
      .catch(() => setCollections([]));
  }, [shopSlug]);

  if (collections.length === 0) return null;

  const columnsClass = COLUMNS_CLASS[shop?.collectionsGridColumns ?? 3];
  const gapClass = GAP_CLASS[shop?.collectionsGridGap ?? "md"];
  const aspectClass = ASPECT_CLASS[shop?.collectionsGridImageAspectRatio ?? "portrait"];
  const showTitle = shop?.collectionsGridShowTitle ?? true;

  return (
    <div className="mb-10 sm:mb-14">
      <div className={`flex ${gapClass} overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory sm:mx-0 sm:px-0 sm:pb-0 sm:grid ${columnsClass} sm:overflow-visible`}>
        {collections.map((c) => (
          <Link
            key={c.id}
            href={`${shopBasePath}/collections/${c.slug}`}
            className={`group relative shrink-0 w-40 sm:w-auto ${aspectClass} rounded-xl overflow-hidden snap-start`}
          >
            {c.image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveImageUrl(c.image) ?? undefined}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {showTitle && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                    <span className="absolute bottom-3 left-3 right-3 text-white font-medium text-sm sm:text-base">
                      {c.name}
                    </span>
                  </>
                )}
              </>
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center text-center px-3"
                style={{ background: "color-mix(in srgb, var(--color-accent) 10%, var(--background))" }}
              >
                {/* Always shown here even with showTitle off — an imageless
                    tile with no caption either would be a blank, unusable
                    rectangle indistinguishable from any other collection. */}
                <span className="font-medium text-sm sm:text-base">{c.name}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
