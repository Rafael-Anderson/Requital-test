"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronDown, Search as SearchIcon } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { getCollectionBySlug, listBrands, listCollections, resolveImageUrl } from "@/lib/api";
import { sanitizeDescriptionHtml } from "@/lib/sanitize-html";
import CurrencySymbol from "@/components/CurrencySymbol";
import type { Brand, CollectionDetail, Collection, Product } from "@/lib/types";
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

// Split into a mobile piece and a tablet/desktop piece (Tailwind classes
// must be literal strings for the JIT scanner, not built via template
// interpolation) - see mobileColumnsFor() for the base-breakpoint rule.
const DESKTOP_COLS_CLASS: Record<2 | 3 | 4 | 5 | 6, string> = {
  2: "sm:grid-cols-2 lg:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-5",
  6: "sm:grid-cols-2 lg:grid-cols-6",
};
const MOBILE_COLS_CLASS: Record<1 | 2, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
};

// Bug fix: this used to hardcode grid-cols-1 as the base breakpoint
// regardless of the merchant's desktop column setting - a merchant's own
// explicit mobileColumns wins when set; otherwise 4/3-column desktop grids
// get 2 mobile columns and 2/1-column grids get 1, matching how the same
// setting already behaves on real ecommerce themes.
function mobileColumnsFor(desktopColumns: 2 | 3 | 4 | 5 | 6, explicit: 1 | 2 | undefined): 1 | 2 {
  if (explicit) return explicit;
  return desktopColumns <= 2 ? 1 : 2;
}

const PAGE_SIZE = 12;

// Static merchant-driven background, not Tailwind's OS-driven dark: variant
// — same fix already applied to lib/form-styles.ts's FIELD_CLASS/checkout's
// own field styles. A prefers-color-scheme:dark visitor used to get a
// near-black dark:bg-zinc-900 box on an otherwise light, merchant-themed
// page (this page never opts into the dark: system elsewhere), reading as a
// broken black input.
const FILTER_FIELD_BG = "bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))]";

// Native <select> can't offer hover/selected states on its own option list
// or an open animation (that's OS chrome, not CSS-controllable) — B10's ask
// (themed background/border/text, hover+selected states, open animation)
// structurally requires a hand-rolled dropdown, same shape as admin's
// Combobox.tsx (trigger + absolute popover), themed with this app's CSS
// vars instead of admin's fixed palette.
function SortDropdown({ value, onChange }: { value: SortOption; onChange: (v: SortOption) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = SORT_OPTIONS.find((o) => o.value === value)!;

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-11 w-[180px] items-center justify-between gap-2 rounded-lg border border-stroke ${FILTER_FIELD_BG} px-3 text-sm text-foreground cursor-pointer`}
      >
        <span className="truncate">{selected.label}</span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div
          role="listbox"
          className={`dropdown-in absolute left-0 top-full z-20 mt-1 w-[220px] rounded-lg border border-stroke ${FILTER_FIELD_BG} py-1 shadow-lg shadow-black/10`}
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-black/5 transition-colors cursor-pointer"
            >
              <span>{opt.label}</span>
              {opt.value === value && <Check className="size-3.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const { shopSlug, shopBasePath, shop, outlets, themeConfig, previewToken, loading: shopLoading, error: shopError } = useShop();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [error, setError] = useState<string | null>(null);

  const defaultOutletId = outlets[0]?.id;

  useEffect(() => {
    if (shopLoading) return;
    setCollection(null);
    getCollectionBySlug(shopSlug, params.slug, defaultOutletId, previewToken)
      .then(setCollection)
      .catch((err) => setError(err instanceof Error ? err.message : "Collection not found"));
  }, [shopSlug, params.slug, defaultOutletId, shopLoading, previewToken]);

  useEffect(() => {
    listCollections(shopSlug, previewToken).then(setAllCollections).catch(() => setAllCollections([]));
    listBrands(shopSlug, previewToken).then(setBrands).catch(() => setBrands([]));
  }, [shopSlug, previewToken]);

  // --- filter/sort/search bar state (storefront-v2 Phase 2B) ---
  const [sort, setSort] = useState<SortOption>("newest");
  const [search, setSearch] = useState("");
  const [selectedBrandIds, setSelectedBrandIds] = useState<Set<number>>(new Set());
  const [showAllBrands, setShowAllBrands] = useState(false);
  // Bug 6 fix: this was shopper-editable (a 2/3/4 column icon selector in
  // the filter bar) - a merchant layout choice, not a customer preference.
  // Now a fixed read from the merchant's own Theme Settings > Collection
  // page > "Products per row" (see CollectionPageSettings.tsx), with no
  // storefront control left to change it. Optional-chained past
  // collectionPage itself, not just themeConfig - a published config saved
  // before this field existed has themeConfig.globalSettings but no
  // .collectionPage.columns on it, which crashed the page outright before
  // this was guarded (confirmed live against this shop's own unpublished
  // theme, not assumed).
  const columns = themeConfig?.globalSettings.collectionPage?.columns ?? 3;
  const mobileColumns = mobileColumnsFor(columns, themeConfig?.globalSettings.collectionPage?.mobileColumns);
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
  }, [search, sort, priceRange, selectedBrandIds, collection?.id]);

  // Brands actually present on this collection's products, intersected with
  // the shop's brand list. Hidden entirely below 2 (nothing to filter by).
  const brandFacets = useMemo(() => {
    if (!collection) return [] as Brand[];
    const present = new Set(
      collection.products.map((p) => p.brand?.id).filter((id): id is number => id != null),
    );
    return brands.filter((b) => present.has(b.id));
  }, [collection, brands]);

  const filtered = useMemo(() => {
    if (!collection) return [];
    const q = search.trim().toLowerCase();
    const [lo, hi] = activeRange;
    const matches = collection.products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      const price = Number(p.price);
      if (price < lo || price > hi) return false;
      if (selectedBrandIds.size > 0 && !selectedBrandIds.has(p.brand?.id ?? -1)) return false;
      return true;
    });
    return sortProducts(matches, sort);
  }, [collection, search, activeRange, sort, selectedBrandIds]);

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

        {/* Filter/sort/search bar (2B). One row, not two ml-auto-split
            groups — that split left a large dead gap on any viewport wider
            than the two groups' combined natural width. Search is the
            dominant control (flex-1) and absorbs whatever space the fixed-
            width controls don't use, rather than sitting at a cramped fixed
            width pinned to the far right. */}
        <div className="flex flex-wrap items-end gap-4 mb-6 pb-4 border-b border-stroke">
          {siblings.length > 0 && (
            <label className="text-sm">
              <span className="block text-xs text-zinc-500 mb-1">Category</span>
              <select
                value={collection.slug}
                onChange={(e) => router.push(`${shopBasePath}/collections/${e.target.value}`)}
                className={`h-11 rounded-lg border border-stroke ${FILTER_FIELD_BG} px-3 text-sm text-foreground`}
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
          <div>
            <span className="block text-xs text-zinc-500 mb-1">Sort by</span>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
          {priceBounds[0] < priceBounds[1] && (
            <div>
              <span className="block text-xs text-zinc-500 mb-1">Price</span>
              <PriceRangeSlider min={priceBounds[0]} max={priceBounds[1]} value={activeRange} onChange={setPriceRange} currency={<CurrencySymbol code={shop?.currency} />} />
            </div>
          )}
          <label className="flex-1 min-w-[240px] text-sm">
            <span className="block text-xs text-zinc-500 mb-1">Search</span>
            <div className="relative">
              <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search this collection"
                className={`h-11 w-full rounded-lg border border-stroke ${FILTER_FIELD_BG} pl-10 pr-3 text-sm text-foreground`}
              />
            </div>
          </label>
        </div>

        {/* Brand filter — client-side, same as price/search/sort above.
            Hidden when the collection has 0 or 1 brand (nothing to filter). */}
        {brandFacets.length > 1 && (
          <div className="mb-6 pb-4 border-b border-stroke">
            <span className="block text-xs text-zinc-500 mb-2">Brand</span>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(showAllBrands ? brandFacets : brandFacets.slice(0, 6)).map((b) => {
                const logo = resolveImageUrl(b.logoUrl);
                return (
                  <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedBrandIds.has(b.id)}
                      onChange={() =>
                        setSelectedBrandIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.id)) next.delete(b.id);
                          else next.add(b.id);
                          return next;
                        })
                      }
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    {logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logo} alt="" className="size-6 rounded object-contain" />
                    )}
                    <span className="text-foreground">{b.name}</span>
                  </label>
                );
              })}
            </div>
            {brandFacets.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllBrands((v) => !v)}
                className="mt-2 text-xs text-accent-text hover:underline cursor-pointer"
              >
                {showAllBrands ? "Show less" : `Show ${brandFacets.length - 6} more`}
              </button>
            )}
          </div>
        )}

        {/* Bug 6 fix: the result-count label already existed here and is
            exactly what the ticket asked to show in place of the removed
            column selector - kept as-is, nothing new needed. */}
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
          <div className={`grid ${MOBILE_COLS_CLASS[mobileColumns]} ${DESKTOP_COLS_CLASS[columns]} gap-6`}>
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
