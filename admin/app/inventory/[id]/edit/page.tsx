"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProduct } from "@/lib/api";
import type { Product } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Skeleton from "@/components/ui/Skeleton";
import ProductForm from "@/components/ProductForm";
import PageShell from "@/components/ui/PageShell";

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const productId = Number(params.id);

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProduct(productId, { allOutlets: true })
      .then(setProduct)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load product"));
  }, [productId]);

  return (
    <PageShell>
      <BackButton href="/inventory" />
      <h1 className="text-2xl font-semibold mb-4">Edit product</h1>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!product && !error ? (
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-8 w-40" />
        </div>
      ) : product ? (
        <ProductForm product={product} />
      ) : null}
    </PageShell>
  );
}
