"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { getMyOrders } from "@/lib/api";
import type { CustomerOrderSummary } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";

export default function OrderHistoryPage() {
  const router = useRouter();
  const { shopSlug, shop } = useShop();
  const { customer, loading: authLoading } = useAuth();

  const [orders, setOrders] = useState<CustomerOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !customer) router.replace("/account/login");
  }, [authLoading, customer, shopSlug, router]);

  useEffect(() => {
    if (!customer) return;
    getMyOrders(shopSlug)
      .then(setOrders)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load orders"));
  }, [shopSlug, customer]);

  if (authLoading || !customer) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  return (
    <StorefrontPageShell variant="medium">
      <Link href="/account" className="text-sm text-zinc-500 hover:text-accent mb-3 inline-block">
        ← Back to account
      </Link>
      <h1 className="text-2xl font-semibold mb-4">Order history</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {orders === null && !error && <p className="text-zinc-500">Loading orders…</p>}
      {orders !== null && orders.length === 0 && <p className="text-zinc-500">You haven&apos;t placed any orders yet.</p>}

      <div className="space-y-3">
        {orders?.map((order) => (
          <Link
            key={order.id}
            href={`/account/orders/${order.id}`}
            className="block rounded-lg border border-black/10 dark:border-white/10 p-4 hover:border-accent/50 transition-colors"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">Order #{order.id}</p>
                <p className="text-xs text-zinc-500">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm capitalize">{order.status}</p>
                <p className="font-medium">
                  {order.total} {shop?.currency}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </StorefrontPageShell>
  );
}
