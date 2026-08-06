"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { getRelatedProducts } from "@/lib/api";
import type { Product } from "@/lib/types";
import ProductCard from "./ProductCard";

// Collection-first, same-category fallback — computed server-side by
// PublicService.getRelatedProducts (Phase 8.4). A product -> collection
// reverse lookup didn't exist on the backend before this; see
// CollectionsService.findRelatedProductIds for how it's resolved.
export default function RelatedProducts({
  productSlug,
  excludeProductId,
  outletId,
}: {
  productSlug: string;
  excludeProductId: number;
  outletId?: number;
}) {
  const { shopSlug } = useShop();
  const [related, setRelated] = useState<Product[] | null>(null);

  useEffect(() => {
    getRelatedProducts(shopSlug, productSlug, outletId)
      .then((all) => setRelated(all.filter((p) => p.id !== excludeProductId).slice(0, 4)))
      .catch(() => setRelated([]));
  }, [shopSlug, productSlug, excludeProductId, outletId]);

  if (!related || related.length === 0) return null;

  return (
    <div className="mt-16 pt-10 border-t border-stroke">
      <h2 className="text-lg font-semibold mb-5">You might also like</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-9">
        {related.map((p) => (
          <ProductCard key={p.id} product={p} orientation="grid" />
        ))}
      </div>
    </div>
  );
}
