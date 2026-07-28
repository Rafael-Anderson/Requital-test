"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { listProducts } from "@/lib/api";
import type { Product } from "@/lib/types";
import ProductCard from "./ProductCard";

// Same-category only, not Collection-based — see the Phase 2 report: a
// product -> collection reverse lookup doesn't exist on the backend today
// (only collection -> products), so building that would mean new backend
// surface. Category is the one relationship every product already has and
// the public API already supports filtering by, so this reuses
// listProducts exactly as the homepage grid does — no new endpoint.
export default function RelatedProducts({
  categoryId,
  excludeProductId,
  outletId,
}: {
  categoryId: number | null;
  excludeProductId: number;
  outletId?: number;
}) {
  const { shopSlug } = useShop();
  const [related, setRelated] = useState<Product[] | null>(null);

  useEffect(() => {
    if (categoryId === null) {
      setRelated([]);
      return;
    }
    listProducts(shopSlug, outletId, categoryId)
      .then((all) => setRelated(all.filter((p) => p.id !== excludeProductId).slice(0, 4)))
      .catch(() => setRelated([]));
  }, [shopSlug, categoryId, excludeProductId, outletId]);

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
