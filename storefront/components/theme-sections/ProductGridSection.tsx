"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { listProducts } from "@/lib/api";
import type { Product } from "@/lib/types";
import type { SectionSettings } from "@/lib/theme-config-types";

const COLUMNS_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

const CARD_STYLE_CLASS: Record<string, string> = {
  minimal: "",
  bordered: "border border-stroke rounded-lg p-2",
  shadowed: "rounded-lg p-2 shadow-sm shadow-black/10",
};

// Homepage teaser, not the full catalog — collection/product browsing
// already has its own real pages (see /[shop]/collections/[slug]).
const MAX_PRODUCTS = 8;

export default function ProductGridSection({ settings }: { settings: SectionSettings }) {
  const { shopSlug, shopBasePath, outlets } = useShop();
  const [products, setProducts] = useState<Product[] | null>(null);
  const outletId = outlets[0]?.id;

  useEffect(() => {
    listProducts(shopSlug, outletId)
      .then((res) => setProducts(res.slice(0, MAX_PRODUCTS)))
      .catch(() => setProducts([]));
  }, [shopSlug, outletId]);

  const columns = COLUMNS_CLASS[(settings.columns as number) ?? 3] ?? COLUMNS_CLASS[3];
  const cardStyle = CARD_STYLE_CLASS[(settings.cardStyle as string) ?? "minimal"] ?? "";
  const showPrice = settings.showPrice !== false;
  // showRating is collected in the admin settings panel but not rendered
  // here — Product has no rating field anywhere in this codebase (no
  // product-review data model exists; SurveyLookupResult.rating is an
  // unrelated post-purchase-survey field). Flagged as a known gap rather
  // than fabricating a fake rating display.

  if (!products || products.length === 0) return null;

  return (
    <div className="px-4 sm:px-6 py-8 max-w-7xl mx-auto">
      <div className={`grid ${columns} gap-4 sm:gap-6`}>
        {products.map((product) => (
          <Link key={product.id} href={`${shopBasePath}/products/${product.slug}`} className={`block group ${cardStyle}`}>
            <div className="aspect-square overflow-hidden bg-black/5" style={{ borderRadius: "var(--theme-radius, 8px)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={product.thumbnail}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-300"
              />
            </div>
            <p className="mt-3 text-sm font-medium line-clamp-2">{product.name}</p>
            {showPrice && <p className="mt-1 text-sm font-semibold">{product.price}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}
