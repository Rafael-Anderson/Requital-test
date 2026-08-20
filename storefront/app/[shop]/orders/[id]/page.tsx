"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import type { OrderResult } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import CurrencySymbol from "@/components/CurrencySymbol";

// Full detail here still depends on reaching this page straight from
// checkout (sessionStorage handoff) — a refresh or a shared link shows a
// friendlier confirmation without it. But every order now has a real,
// persistent lookup path independent of that: order.trackingToken, surfaced
// prominently below and usable any time at /<shop>/orders/track — that's
// the thing worth saving/writing down, not this URL.
function OrderConfirmationContent() {
  const params = useParams<{ shop: string; id: string }>();
  const searchParams = useSearchParams();
  const { shop, shopBasePath } = useShop();
  const [order, setOrder] = useState<OrderResult | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(`requital_order:${params.id}`);
    if (raw) setOrder(JSON.parse(raw) as OrderResult);
  }, [params.id]);

  const paid = searchParams.get("paid") === "1";

  return (
    <StorefrontPageShell variant="medium">
    <div className="text-center py-12">
      <h1 className="text-2xl font-semibold">Thank you!</h1>
      <p className="text-zinc-600 mt-2">
        Order #{params.id} has been placed{order ? ` with ${order.orderType}` : ""}.
      </p>
      {paid && <p className="text-accent mt-2">Payment received.</p>}

      {order?.trackingToken && (
        <div className="mt-6 rounded-lg border border-accent/30 bg-accent/5 p-4 text-left">
          <p className="text-sm font-medium">Save your tracking code</p>
          <p className="text-xs text-zinc-500 mt-1">
            Use this code to check your order status any time. No account needed. If you have an account, it&apos;ll
            also show up in your order history.
          </p>
          <p className="mt-2 font-mono text-lg tracking-wide">{order.trackingToken}</p>
          <Link
            href={`${shopBasePath}/orders/track?token=${order.trackingToken}`}
            className="inline-block mt-2 text-sm text-accent hover:underline"
          >
            Track this order →
          </Link>
        </div>
      )}

      {order && (
        <div className="mt-6 text-left rounded-lg border border-black/10 p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Status</span>
            <span>{order.status}</span>
          </div>
          {order.deliveryFee !== null && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Delivery fee</span>
              <span>
                {order.deliveryFee} <CurrencySymbol code={shop?.currency} />
              </span>
            </div>
          )}
          {order.discountAmount !== null && Number(order.discountAmount) > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Discount{order.discountCode ? ` (${order.discountCode})` : ""}</span>
              <span>
                -{order.discountAmount} <CurrencySymbol code={shop?.currency} />
              </span>
            </div>
          )}
          {order.taxAmount !== null && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Tax</span>
              <span>
                {order.taxAmount} <CurrencySymbol code={shop?.currency} />
              </span>
            </div>
          )}
          <div className="flex justify-between font-medium pt-1 border-t border-black/10">
            <span>Total</span>
            <span>
              {order.total} <CurrencySymbol code={shop?.currency} />
            </span>
          </div>
        </div>
      )}
      <Link href={shopBasePath || "/"} className="inline-block mt-6 text-accent hover:underline">
        Continue shopping
      </Link>
    </div>
    </StorefrontPageShell>
  );
}

export default function OrderConfirmationPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <OrderConfirmationContent />
    </Suspense>
  );
}
