"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { getMyInvoiceHtml, getMyOrder } from "@/lib/api";
import type { CustomerOrderSummary } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";

export default function OrderDetailPage() {
  const router = useRouter();
  const { shopSlug, shopBasePath, shop } = useShop();
  const { customer, loading: authLoading } = useAuth();
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);

  const [order, setOrder] = useState<CustomerOrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);

  useEffect(() => {
    if (!authLoading && !customer) router.replace(`${shopBasePath}/account/login`);
  }, [authLoading, customer, shopBasePath, router]);

  useEffect(() => {
    if (!customer) return;
    getMyOrder(shopSlug, orderId)
      .then(setOrder)
      .catch((err) => setError(err instanceof Error ? err.message : "Order not found"));
  }, [shopSlug, orderId, customer]);

  if (authLoading || !customer) {
    return <p className="text-zinc-500">Loading…</p>;
  }

  // Opens the invoice as a real HTML document in a new tab (via a Blob URL)
  // rather than a plain <a href> — the endpoint needs the customer's bearer
  // token attached (see lib/api.ts's authedFetchText), which a static link
  // can't do. From there the browser's own Print > Save as PDF covers
  // "download as PDF" without this app carrying a PDF-generation dependency.
  async function handleDownloadInvoice() {
    setDownloadingInvoice(true);
    try {
      const html = await getMyInvoiceHtml(shopSlug, orderId);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoice");
    } finally {
      setDownloadingInvoice(false);
    }
  }

  return (
    <StorefrontPageShell variant="medium">
      <Link href={`${shopBasePath}/account/orders`} className="text-sm text-zinc-500 hover:text-accent mb-3 inline-block">
        ← Back to order history
      </Link>
      <h1 className="text-2xl font-semibold mb-4">Order #{orderId}</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {order && (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
          <div className="flex justify-between">
            <span className="text-zinc-500">Status</span>
            <span className="capitalize font-medium">{order.status}</span>
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
            <div className="flex justify-between">
              <span className="text-zinc-500">Delivery address</span>
              <span className="text-right max-w-56">{order.customerAddress}</span>
            </div>
            {order.deliveryTimeSlot && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Time slot</span>
                <span>{order.deliveryTimeSlot}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-zinc-500">Payment</span>
              <span className="capitalize">
                {order.paymentMethod?.replace(/_/g, " ") ?? "-"} · {order.paymentStatus}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Placed</span>
              <span>{new Date(order.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-3 text-sm space-y-1">
            {order.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <div>
                  <span>
                    {item.quantity}× {item.productName}
                  </span>
                  {item.variantLabel && <p className="text-xs text-zinc-500">{item.variantLabel}</p>}
                </div>
                <span>
                  {item.priceAtPurchase} {shop?.currency}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-black/10 dark:border-white/10 pt-3 text-sm space-y-1">
            {order.deliveryFee && (
              <div className="flex justify-between text-zinc-500">
                <span>Delivery fee</span>
                <span>
                  {order.deliveryFee} {shop?.currency}
                </span>
              </div>
            )}
            {order.discountAmount && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>Discount</span>
                <span>
                  -{order.discountAmount} {shop?.currency}
                </span>
              </div>
            )}
            {order.taxAmount && (
              <div className="flex justify-between text-zinc-500">
                <span>Tax</span>
                <span>
                  {order.taxAmount} {shop?.currency}
                </span>
              </div>
            )}
            <div className="flex justify-between font-medium pt-1">
              <span>Total</span>
              <span>
                {order.total} {shop?.currency}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {order.trackingToken && (
              <Link
                href={`${shopBasePath}/orders/track?token=${order.trackingToken}`}
                className="text-sm text-accent hover:underline"
              >
                Track this order
              </Link>
            )}
            {order.hasInvoice && (
              <button
                type="button"
                onClick={handleDownloadInvoice}
                disabled={downloadingInvoice}
                className="text-sm text-accent hover:underline disabled:opacity-50 cursor-pointer"
              >
                {downloadingInvoice ? "Loading…" : "Download Invoice"}
              </button>
            )}
          </div>
        </div>
      )}
    </StorefrontPageShell>
  );
}
