"use client";

import Link from "next/link";
import { resolveImageUrl } from "@/lib/api";
import { useShop } from "@/lib/shop-context";
import type { Collection } from "@/lib/types";
import ClassicHero from "./ClassicHero";

// Pure (no DOM) so the filter/sort itself is directly testable. Shows every
// top-level collection (same set CollectionNav already fetches), not just ones
// marked isFeatured — filtering to isFeatured would render an empty,
// broken-looking section for the many shops that have never touched that
// flag. Featured collections are just sorted first as a light nod to it.
export function selectTiles(collections: Collection[]): Collection[] {
  return collections
    .filter((c) => c.parentCollectionId === null)
    .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.displayOrder - b.displayOrder);
}

// Explicit column count per tile count rather than auto-fit/auto-fill — an
// earlier attempt at auto-fit fought the grid's own sizing algorithm and
// collapsed to a single stacked column instead of shrinking cleanly (see the
// removed KNOWN GAP comment this replaced). 4+ keeps the original
// grid-cols-2 sm:grid-cols-4 behavior unchanged; 1-3 get a layout that fills
// the tinted band exactly instead of leaving dead space beside fewer tiles.
export function gridClassName(count: number): string {
  if (count <= 1) return "grid grid-cols-1 gap-3";
  if (count === 2) return "grid grid-cols-2 gap-3";
  if (count === 3) return "grid grid-cols-2 gap-3";
  return "grid grid-cols-2 sm:grid-cols-4 gap-3";
}

// With exactly 3 tiles, the third spans both columns to form a full-width
// bottom row under the two top tiles — a balanced layout rather than an
// uneven 2-then-1-narrow row.
export function tileClassName(count: number, index: number): string {
  return count === 3 && index === 2 ? "col-span-2" : "";
}

// "Featured Grid" layout — the same banner/heroText top strip as Classic,
// plus a prominent grid of collection tiles above the product listing.
export default function FeaturedGrid({
  bannerUrl,
  heroText,
  collections,
}: {
  bannerUrl: string | null;
  heroText: string | null;
  collections: Collection[];
}) {
  const { shopBasePath } = useShop();
  const topLevel = selectTiles(collections);

  return (
    <>
      <ClassicHero bannerUrl={bannerUrl} heroText={heroText} />
      {topLevel.length > 0 && (
        <div className="mb-6 rounded-lg bg-featured-bg p-4">
          <div className={gridClassName(topLevel.length)}>
            {topLevel.map((c, i) => (
              <Link
                key={c.id}
                href={`${shopBasePath}/collections/${c.slug}`}
                className={`group rounded-lg overflow-hidden bg-white border border-stroke ${tileClassName(topLevel.length, i)}`}
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
                {c.image && <p className="px-2 py-1.5 text-xs font-medium truncate text-featured-fg">{c.name}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
