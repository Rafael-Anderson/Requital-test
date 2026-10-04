"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getProduct } from "@/lib/api";
import type { Product } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Skeleton from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import ProductForm from "@/components/ProductForm";
import PageShell from "@/components/ui/PageShell";

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const productId = Number(params.id);

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Try again bumps `reloadKey`; the load runs in promise callbacks.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let live = true;
    getProduct(productId, { allOutlets: true })
      .then((p) => {
        if (live) setProduct(p);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load product");
      });
    return () => {
      live = false;
    };
  }, [productId, reloadKey]);

  return (
    <PageShell>
      <BackButton href="/products" />
      <h1 className="text-2xl font-semibold mb-4">Edit product</h1>
      {!product && error ? (
        <LoadFailed
          what="the product"
          onRetry={() => {
            setError(null);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : !product ? (
        <div className="max-w-2xl space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-8 w-40" />
        </div>
      ) : (
        <ProductForm product={product} />
      )}
    </PageShell>
  );
}
