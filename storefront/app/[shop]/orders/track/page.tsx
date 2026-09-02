"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { lookupOrder, getMyOrder } from "@/lib/api";
import type { OrderLookupResult } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import { AUTH_CARD_CLASS, AUTH_HEADING_CLASS, FIELD_CLASS, BUTTON_PRIMARY_CLASS } from "@/lib/form-styles";
import CurrencySymbol from "@/components/CurrencySymbol";

function TrackOrderContent() {
  const { shopSlug, shopBasePath, shop } = useShop();
  const { customer, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();

  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [order, setOrder] = useState<OrderLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Whether the order just looked up is one of the signed-in customer's own
  // — confirmed server-side via the customer-scoped order endpoint (it
  // 404s for an order that isn't theirs), not inferred client-side, since
  // OrderLookupResult itself is intentionally identity-agnostic (see
  // PublicService.lookupOrder — no customerId/email/phone in that response).
  const [ownedByCurrentCustomer, setOwnedByCurrentCustomer] = useState(false);

  async function handleLookup(t: string) {
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      setOrder(await lookupOrder(t.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't find that order");
    } finally {
      setLoading(false);
    }
  }

  // Auto-lookup when arriving via a link that already has ?token=...
  useEffect(() => {
    const fromUrl = searchParams.get("token");
    if (fromUrl) void handleLookup(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate from handleLookup and gated on authLoading rather than done
  // inline: whether `customer` has hydrated yet from localStorage can't be
  // assumed at the moment auto-lookup fires on mount, so this re-checks
  // ownership any time either the order or the auth state actually settles.
  useEffect(() => {
    if (!order || authLoading) return;
    if (!customer) {
      setOwnedByCurrentCustomer(false);
      return;
    }
    let cancelled = false;
    getMyOrder(shopSlug, order.id)
      .then(() => {
        if (!cancelled) setOwnedByCurrentCustomer(true);
      })
      .catch(() => {
        // Not theirs (someone else's order, e.g. a gift, shared via link) —
        // guest-style tracking still works fine, just no "this is yours"
        // treatment below.
        if (!cancelled) setOwnedByCurrentCustomer(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order, customer, authLoading, shopSlug]);

  return (
    <StorefrontPageShell variant="narrow">
      <div className={AUTH_CARD_CLASS}>
      <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>Track your order</h1>
      {customer ? (
        <p className="text-sm text-zinc-500 mb-6">
          Signed in as {customer.name}. Look up any order below by its tracking code, or see everything at once in
          your{" "}
          <Link href={`${shopBasePath}/account/orders`} className="text-accent hover:underline">
            order history
          </Link>
          .
        </p>
      ) : (
        <p className="text-sm text-zinc-500 mb-6">
          Enter the tracking code from your order confirmation to check its status. No account needed. Already have
          an account?{" "}
          <Link href={`${shopBasePath}/account/login`} className="text-accent hover:underline">
            Sign in
          </Link>{" "}
          to see your full order history instead of tracking one order at a time.
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleLookup(token);
        }}
        className="flex gap-2"
      >
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Tracking code"
          className={`flex-1 ${FIELD_CLASS}`}
        />
        <button type="submit" disabled={loading} className={BUTTON_PRIMARY_CLASS}>
          {loading ? "Looking up…" : "Track"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
      {!order && !error && shop && (
        <p className="text-xs text-zinc-400 mt-4">Orders from {shop.name} can be tracked here.</p>
      )}
      </div>

      {order && (
        <div className="mt-6 rounded-lg border border-black/10 bg-background p-4 space-y-3">
          {ownedByCurrentCustomer && (
            <div className="flex items-center justify-between gap-3 -mt-1 -mx-1 mb-1 px-1 pb-3 border-b border-black/10">
              <p className="text-xs text-accent">This is one of your orders.</p>
              <Link href={`${shopBasePath}/account/orders/${order.id}`} className="text-xs text-accent hover:underline shrink-0">
                View full details →
              </Link>
            </div>
          )}
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide">Order #{order.id}</p>
            <p className="font-medium">{order.status}</p>
          </div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-500">Fulfillment</span>
              <span className="capitalize">{order.orderType ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Location</span>
              <span>{order.outletName}</span>
            </div>
            {order.estimatedTime && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Estimated time</span>
                <span>{order.estimatedTime}</span>
              </div>
            )}
            {order.deliveryTimeSlot && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Time slot</span>
                <span>{order.deliveryTimeSlot}</span>
              </div>
            )}
          </div>
          <div className="border-t border-black/10 pt-3 text-sm space-y-1">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <div>
                  <span>
                    {item.quantity}× {item.productName}
                  </span>
                  {item.variantLabel && <p className="text-xs text-zinc-500">{item.variantLabel}</p>}
                </div>
              </div>
            ))}
            <div className="flex justify-between font-medium pt-1">
              <span>Total</span>
              <span>
                {order.total} <CurrencySymbol code={order.currency} />
              </span>
            </div>
          </div>

          {/* Light touch, not a wall: a guest holding this link whose order
              contact happens to already have a registered account gets a
              nudge, never a requirement — guest tracking above works
              exactly the same whether or not this renders. Never shown once
              they're actually signed in (that's the "this is one of your
              orders" banner above instead), and never shown if it's already
              confirmed to be someone else's order while a different
              customer is signed in. */}
          {!customer && order.hasAccount && (
            <div className="border-t border-black/10 pt-3">
              <p className="text-xs text-zinc-500">
                This order is linked to an account on {shop?.name ?? "this store"}.{" "}
                <Link href={`${shopBasePath}/account/login`} className="text-accent hover:underline">
                  Sign in
                </Link>{" "}
                to see all your orders in one place.
              </p>
            </div>
          )}
        </div>
      )}
    </StorefrontPageShell>
  );
}

export default function TrackOrderPage() {
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <TrackOrderContent />
    </Suspense>
  );
}
