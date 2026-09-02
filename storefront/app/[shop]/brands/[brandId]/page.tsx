"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { listBrands, listProducts, resolveImageUrl } from "@/lib/api";
import ProductCard from "@/components/ProductCard";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import StorefrontLoadingSkeleton from "@/components/StorefrontLoadingSkeleton";
import StorefrontErrorState from "@/components/StorefrontErrorState";
import type { Brand, Product } from "@/lib/types";

type SortOption = "newest" | "price-asc" | "price-desc" | "name";

const SORTS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name", label: "Name A–Z" },
];

function sortProducts(products: Product[], sort: SortOption): Product[] {
  const copy = [...products];
  switch (sort) {
    case "price-asc":
      return copy.sort((a, b) => Number(a.price) - Number(b.price));
    case "price-desc":
      return copy.sort((a, b) => Number(b.price) - Number(a.price));
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    default:
      return copy; // backend already returns newest-first
  }
}

// Brand-filtered product listing — /[shop]/brands/[brandId]. Deliberately a
// lean cut of the /collections/[slug] page (no sub-collection nav, price
// slider, banner or description — none of which a brand has), reusing
// ProductCard + the shared shell. `brandId` is numeric because the `brand`
// table has no slug column; the Brands theme section links here by id.
export default function BrandPage() {
  const params = useParams<{ shop: string; brandId: string }>();
  const rawBrandId = Number(params.brandId);
  const validBrandId = Number.isFinite(rawBrandId);
  const brandId = validBrandId ? rawBrandId : undefined;
  const { shopSlug, shopBasePath, outlets, previewToken } = useShop();
  const outletId = outlets[0]?.id;

  const [brand, setBrand] = useState<Brand | null | undefined>(undefined);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState(false);
  const [sort, setSort] = useState<SortOption>("newest");

  useEffect(() => {
    if (brandId === undefined) return;
    listBrands(shopSlug, previewToken)
      .then((brands) => setBrand(brands.find((b) => b.id === brandId) ?? null))
      .catch(() => setError(true));
  }, [shopSlug, brandId, previewToken]);

  useEffect(() => {
    if (brandId === undefined) return;
    listProducts(shopSlug, outletId, undefined, undefined, previewToken, brandId)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [shopSlug, outletId, brandId, previewToken]);

  const sorted = useMemo(() => sortProducts(products ?? [], sort), [products, sort]);

  const notFound = (
    <StorefrontPageShell variant="wide">
      <nav className="text-xs text-zinc-500 mb-4">
        <Link href={shopBasePath || "/"} className="hover:underline">
          Home
        </Link>
      </nav>
      <h1 className="text-2xl font-bold text-product-name">Brand not found</h1>
      <p className="mt-2 text-zinc-500">We couldn&apos;t find any products for this brand right now.</p>
    </StorefrontPageShell>
  );

  if (error) return <StorefrontErrorState variant="error" />;
  if (brandId === undefined) return notFound; // non-numeric route segment
  if (brand === undefined || products === null) return <StorefrontLoadingSkeleton />;
  if (brand === null) return notFound;

  const logo = resolveImageUrl(brand.logoUrl);

  return (
    <StorefrontPageShell variant="wide">
      <nav className="text-xs text-zinc-500 mb-4">
        <Link href={shopBasePath || "/"} className="hover:underline">
          Home
        </Link>
        {" / "}
        <span>{brand.name}</span>
      </nav>

      <div className="flex items-center gap-3 mb-6">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={brand.name} className="h-10 w-auto max-w-32 object-contain" />
        )}
        <h1 className="text-[32px] font-extrabold leading-tight text-product-name">{brand.name}</h1>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-4 border-b border-stroke">
        <p className="text-sm text-zinc-500">
          {sorted.length} product{sorted.length === 1 ? "" : "s"}
        </p>
        <label className="text-sm">
          <span className="sr-only">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="h-10 rounded-lg border border-stroke bg-white px-3 text-sm text-foreground"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <p className="text-zinc-500">No products from this brand yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {sorted.map((p) => (
            <ProductCard key={p.id} product={p} orientation="grid" />
          ))}
        </div>
      )}
    </StorefrontPageShell>
  );
}
