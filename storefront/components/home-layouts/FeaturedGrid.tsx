import Link from "next/link";
import { resolveImageUrl } from "@/lib/api";
import type { Category } from "@/lib/types";
import ClassicHero from "./ClassicHero";

// Pure (no DOM) so the filter/sort itself is directly testable. Shows every
// top-level category (same set CategoryNav already fetches), not just ones
// marked isFeatured — filtering to isFeatured would render an empty,
// broken-looking section for the many shops that have never touched that
// flag. Featured categories are just sorted first as a light nod to it.
export function selectTiles(categories: Category[]): Category[] {
  return categories
    .filter((c) => c.parentCategoryId === null)
    .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.displayOrder - b.displayOrder);
}

// "Featured Grid" layout — the same banner/heroText top strip as Classic,
// plus a prominent grid of category tiles above the product listing.
export default function FeaturedGrid({
  shopSlug,
  bannerUrl,
  heroText,
  categories,
}: {
  shopSlug: string;
  bannerUrl: string | null;
  heroText: string | null;
  categories: Category[];
}) {
  const topLevel = selectTiles(categories);

  return (
    <>
      <ClassicHero bannerUrl={bannerUrl} heroText={heroText} />
      {topLevel.length > 0 && (
        // KNOWN GAP (storefront layout audit): with only 1-2 categories,
        // this tinted band still shows dead space next to the tiles at
        // sm:grid-cols-4 — same root cause CategoryShowcase.tsx's own tiles
        // had, but auto-fit/w-fit tricks here fought the grid's own sizing
        // algorithm (columns collapsed to a single stacked column instead
        // of shrinking cleanly). Left as the stable, previously-shipped
        // behavior rather than risk a worse-looking regression; flagged as
        // a follow-up rather than fixed under this task.
        <div className="mb-6 rounded-lg bg-featured-bg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {topLevel.map((c) => (
              <Link
                key={c.id}
                href={`/${shopSlug}?category=${c.id}`}
                className="group rounded-lg overflow-hidden bg-white dark:bg-zinc-900 border border-stroke"
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
