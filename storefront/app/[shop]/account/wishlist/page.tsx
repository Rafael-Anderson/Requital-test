"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { useWishlist, wishlistEnabled } from "@/lib/wishlist";
import { getMyWishlistProducts } from "@/lib/api";
import type { Product } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import ProductCard from "@/components/ProductCard";

export default function WishlistPage() {
  const router = useRouter();
  const { shopSlug, shopBasePath, themeConfig } = useShop();
  const { customer, loading: authLoading } = useAuth();
  // Subscribing to the context re-fetches the resolved list when the shopper
  // removes an item from a card on this very page.
  const { ids } = useWishlist();

  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = wishlistEnabled(themeConfig);

  // Feature off ⇒ this page doesn't exist for this shop (same treatment as
  // any other disabled account section) — send them back to the dashboard.
  useEffect(() => {
    if (!enabled) router.replace(`${shopBasePath}/account`);
  }, [enabled, shopBasePath, router]);

  useEffect(() => {
    if (!authLoading && !customer) router.replace(`${shopBasePath}/account/login`);
  }, [authLoading, customer, shopBasePath, router]);

  useEffect(() => {
    if (!enabled || !customer) return;
    getMyWishlistProducts(shopSlug)
      .then(setProducts)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load your wishlist"));
    // ids is a dep so a remove-from-card refetches the resolved cards.
  }, [shopSlug, customer, enabled, ids]);

  if (!enabled || authLoading || !customer) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  return (
    <StorefrontPageShell variant="medium">
      <Link href={`${shopBasePath}/account`} className="text-sm text-zinc-500 hover:text-accent mb-3 inline-block">
        ← Back to account
      </Link>
      <h1 className="text-2xl font-semibold mb-4">Wishlist</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {products === null && !error && <p className="text-zinc-500">Loading your wishlist…</p>}
      {products !== null && products.length === 0 && (
        <p className="text-zinc-500">
          Nothing saved yet. Tap the heart on any product to add it here.
        </p>
      )}

      {products !== null && products.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} orientation="grid" />
          ))}
        </div>
      )}
    </StorefrontPageShell>
  );
}
