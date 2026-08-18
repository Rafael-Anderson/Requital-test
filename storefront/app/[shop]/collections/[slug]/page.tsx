"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Search as SearchIcon } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { getCollectionBySlug, listCollections, resolveImageUrl } from "@/lib/api";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import { currencySymbol } from "@/lib/currency";
import type { CollectionDetail, Collection, Product } from "@/lib/types";
import ProductCard from "@/components/ProductCard";
import PriceRangeSlider from "@/components/PriceRangeSlider";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import StorefrontLoadingSkeleton from "@/components/StorefrontLoadingSkeleton";
import StorefrontErrorState from "@/components/StorefrontErrorState";

const SORT_OPTIONS = [
  { value: "best_selling", label: "Best Selling" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A → Z" },
  { value: "za", label: "Z → A" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
] as const;
type SortOption = (typeof SORT_OPTIONS)[number]["value"];

const GRID_COLS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

const PAGE_SIZE = 12;

function sortProducts(products: Product[], sort: SortOption): Product[] {
  const arr = [...products];
  switch (sort) {
    case "best_selling":
      return arr.sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0));
    case "newest":
      return arr.sort((a, b) => b.id - a.id);
    case "oldest":
      return arr.sort((a, b) => a.id - b.id);
    case "az":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "za":
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    case "price_asc":
      return arr.sort((a, b) => Number(a.price) - Number(b.price));
    case "price_desc":
      return arr.sort((a, b) => Number(b.price) - Number(a.price));
  }
}

// Collection (taxonomy node) detail — /[shop]/collections/[slug]. Repurposed
// from the pre-Phase-C curated-list detail that used to live at this same
// URL (now served by /[shop]'s Template homepage sections + getTemplate
// instead — see lib/api.ts). Reworked for storefront-v2 Phase 2: a real
// banner, a combinable client-side filter/sort/search bar, and merchant
// rich text above/below the grid — all client-side, since the backend
// fetches this collection's full product list in one shot (no pagination
// params on GET /public/:shopSlug/collections/:slug to page through).
export default function CollectionPage() {
  const params = useParams<{ shop: string; slug: string }>();
  const router = useRouter();
  const { shopSlug, shopBasePath, shop, outlets, themeConfig, loading: shopLoading, error: shopError } = useShop();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [error, setError] = useState<string | null>(null);

  const defaultOutletId = outlets[0]?.id;

  useEffect(() => {
    if (shopLoading) return;
    setCollection(null);
    getCollectionBySlug(shopSlug, params.slug, defaultOutletId)
      .then(setCollection)
      .catch((err) => setError(err instanceof Error ? err.message : "Collection not found"));
  }, [shopSlug, params.slug, defaultOutletId, shopLoading]);

  useEffect(() => {
    listCollections(shopSlug).then(setAllCollections).catch(() => setAllCollections([]));
  }, [shopSlug]);

  // --- filter/sort/search bar state (storefront-v2 Phase 2B) ---
  const [sort, setSort] = useState<SortOption>("newest");
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState<2 | 3 | 4>(3);
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [page, setPage] = useState(1);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const priceBounds = useMemo((): [number, number] => {
    if (!collection || collection.products.length === 0) return [0, 0];
    const prices = collection.products.map((p) => Number(p.price));
    return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))];
  }, [collection]);
  const activeRange = priceRange ?? priceBounds;

  // Reset paging whenever a filter/sort input (or the collection itself)
  // changes — never reset on `columns`, which only changes layout.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setPage(1);
  }, [search, sort, priceRange, collection?.id]);

  const filtered = useMemo(() => {
    if (!collection) return [];
    const q = search.trim().toLowerCase();
    const [lo, hi] = activeRange;
    const matches = collection.products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      const price = Number(p.price);
      if (price < lo || price > hi) return false;
      return true;
    });
    return sortProducts(matches, sort);
  }, [collection, search, activeRange, sort]);

  const collectionPageSettings = themeConfig?.globalSettings.collectionPage;
  const loadMoreStyle = collectionPageSettings?.loadMoreStyle ?? "infinite";
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleProducts =
    loadMoreStyle === "pagination" ? filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : filtered.slice(0, visibleCount);

  useEffect(() => {
    if (loadMoreStyle !== "infinite") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisibleCount((c) => Math.min(filtered.length, c + PAGE_SIZE));
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMoreStyle, filtered.length]);

  if (shopError) return <StorefrontErrorState variant="error" />;
  if (error) return <p className="text-red-600">{error}</p>;
  if (shopLoading || collection === null) return <StorefrontLoadingSkeleton />;

  const listOrientation = shop?.productDisplayOrientation === "list";
  const parent = collection.parentCollectionId ? allCollections.find((c) => c.id === collection.parentCollectionId) : undefined;
  const siblings = allCollections.filter((c) => c.parentCollectionId === collection.parentCollectionId && c.id !== collection.id);
  const bannerImage = resolveImageUrl(collection.image);

  const richTextStyle = collectionPageSettings
    ? {
        fontFamily: collectionPageSettings.fontFamily || undefined,
        fontSize: `${collectionPageSettings.fontSize}px`,
        color: collectionPageSettings.textColor || undefined,
      }
    : undefined;

  return (
    <>
      {/* Banner (2A) — merchant image with a dark overlay for text
          legibility, or a flat accent-tint fallback when the collection has
          no image of its own. */}
      <div
        className="relative w-full flex items-end"
        style={{
          height: 220,
          background: bannerImage ? undefined : "#E6F5F3",
        }}
      >
        {bannerImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bannerImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/40" />
          </>
        )}
        <div className="relative mx-auto w-full px-4 sm:px-6 pb-6" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
          <nav className={`text-xs mb-2 ${bannerImage ? "text-white/80" : "text-zinc-500"}`}>
            <Link href={shopBasePath || "/"} className="hover:underline">
              Home
            </Link>
            {parent && (
              <>
                {" / "}
                <Link href={`${shopBasePath}/collections/${parent.slug}`} className="hover:underline">
                  {parent.name}
                </Link>
              </>
            )}
            {" / "}
            <span>{collection.name}</span>
          </nav>
          <h1 className={`text-[32px] font-extrabold leading-tight ${bannerImage ? "text-white" : "text-product-name"}`}>
            {collection.name}
          </h1>
          {collection.description && (
            <p className={`mt-1 text-[15px] max-w-2xl ${bannerImage ? "text-white/85" : "text-zinc-600"}`}>{collection.description}</p>
          )}
        </div>
      </div>

      <StorefrontPageShell variant="wide">
        {collectionPageSettings?.textAboveProducts && (
          <div
            className="mb-6"
            style={richTextStyle}
            dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(collectionPageSettings.textAboveProducts) }}
          />
        )}

        {/* Filter/sort/search bar (2B) */}
        <div className="flex flex-wrap items-end gap-4 mb-6 pb-4 border-b border-stroke">
          <div className="flex flex-wrap items-end gap-3">
            {siblings.length > 0 && (
              <label className="text-sm">
                <span className="block text-xs text-zinc-500 mb-1">Category</span>
                <select
                  value={collection.slug}
                  onChange={(e) => router.push(`${shopBasePath}/collections/${e.target.value}`)}
                  className="h-9 rounded-lg border border-stroke bg-white dark:bg-zinc-900 px-2 text-sm"
                >
                  <option value={collection.slug}>{collection.name}</option>
                  {siblings.map((s) => (
                    <option key={s.id} value={s.slug}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm">
              <span className="block text-xs text-zinc-500 mb-1">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="h-9 rounded-lg border border-stroke bg-white dark:bg-zinc-900 px-2 text-sm"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {priceBounds[0] < priceBounds[1] && (
              <div>
                <span className="block text-xs text-zinc-500 mb-1">Price</span>
                <PriceRangeSlider min={priceBounds[0]} max={priceBounds[1]} value={activeRange} onChange={setPriceRange} currency={currencySymbol(shop?.currency)} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 ml-auto">
            <label className="text-sm">
              <span className="block text-xs text-zinc-500 mb-1">Search</span>
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search this collection"
                  className="h-9 w-44 rounded-lg border border-stroke bg-white dark:bg-zinc-900 pl-8 pr-2 text-sm"
                />
              </div>
            </label>
            {!listOrientation && (
              <div className="flex items-center gap-1">
                {([2, 3, 4] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setColumns(n)}
                    aria-label={`${n} columns`}
                    aria-pressed={columns === n}
                    className={`flex items-center justify-center size-9 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      columns === n ? "border-accent bg-accent/10 text-accent-text" : "border-stroke text-zinc-500 hover:border-black/30"
                    }`}
                  >
                    <LayoutGrid className="size-4" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-sm text-zinc-500 mb-4">
          {filtered.length} product{filtered.length === 1 ? "" : "s"}
        </p>

        {filtered.length === 0 ? (
          <p className="text-zinc-500">No products match these filters.</p>
        ) : listOrientation ? (
          <div className="max-w-2xl">
            {visibleProducts.map((p) => (
              <ProductCard key={p.id} product={p} orientation="list" />
            ))}
          </div>
        ) : (
          <div className={`grid ${GRID_COLS[columns]} gap-6`}>
            {visibleProducts.map((p) => (
              <ProductCard key={p.id} product={p} orientation="grid" />
            ))}
          </div>
        )}

        {loadMoreStyle === "infinite" && visibleCount < filtered.length && <div ref={sentinelRef} className="h-1" />}

        {loadMoreStyle === "pagination" && totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 mt-8">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-9 px-3 rounded-lg border border-stroke text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPage(n)}
                className={`h-9 min-w-9 px-2 rounded-lg border text-sm cursor-pointer ${
                  n === page ? "border-accent bg-accent/10 text-accent-text" : "border-stroke hover:border-black/30"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-9 px-3 rounded-lg border border-stroke text-sm disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
            </button>
          </div>
        )}

        {collectionPageSettings?.textBelowProducts && (
          <div
            className="mt-8"
            style={richTextStyle}
            dangerouslySetInnerHTML={{ __html: sanitizeDescriptionHtml(collectionPageSettings.textBelowProducts) }}
          />
        )}
      </StorefrontPageShell>
    </>
  );
}
