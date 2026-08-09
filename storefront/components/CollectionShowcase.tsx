"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listCollections, resolveImageUrl } from "@/lib/api";
import type { Collection } from "@/lib/types";

// A homepage showcase row, distinct from components/CollectionNav.tsx (the
// header's compact text-pill filter bar) — this is a landing element in its
// own right: collection photography where set, sized to actually invite a
// click rather than a functional filter control. One of the highest-impact
// homepage elements for reducing bounce (a visitor who doesn't yet know
// what to search for still has somewhere obvious to go) — see the Phase 2
// design brief. Horizontal scroll on narrow screens, a real grid from sm up.
export default function CollectionShowcase() {
  const { shopSlug } = useShop();
  const [collections, setCollections] = useState<Collection[]>([]);

  useEffect(() => {
    listCollections(shopSlug)
      .then((all) => setCollections(all.filter((c) => c.parentCollectionId === null)))
      .catch(() => setCollections([]));
  }, [shopSlug]);

  if (collections.length === 0) return null;

  return (
    <div className="mb-10 sm:mb-14">
      {/* sm:grid-cols-[repeat(auto-fit,minmax(...))] rather than a fixed
          column count — a fixed sm:grid-cols-3/lg:grid-cols-4 sizes every
          track evenly regardless of item count, so a shop with only 1-2
          collections got tiles stretched thin with a wide dead gap next to
          them instead of tiles sized to actually invite a click (found
          during the storefront layout audit, made more visible once the
          surrounding page went from max-w-6xl to the current wider shell). */}
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory sm:mx-0 sm:px-0 sm:pb-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(180px,240px))] sm:overflow-visible">
        {collections.map((c) => (
          <Link
            key={c.id}
            href={`/${shopSlug}/collections/${c.slug}`}
            className="group relative shrink-0 w-40 sm:w-auto aspect-[4/5] rounded-xl overflow-hidden snap-start"
          >
            {c.image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={resolveImageUrl(c.image) ?? undefined}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0" />
                <span className="absolute bottom-3 left-3 right-3 text-white font-medium text-sm sm:text-base">
                  {c.name}
                </span>
              </>
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center text-center px-3"
                style={{ background: "color-mix(in srgb, var(--color-accent) 10%, var(--background))" }}
              >
                <span className="font-medium text-sm sm:text-base">{c.name}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
