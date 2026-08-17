"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  cancelOrder,
  generatePaymentLink,
  getOrder,
  updateOrderStatus,
} from "@/lib/api";
import { getValidNextStatuses, type Order, type OrderStatus } from "@/lib/types";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";
import OrderNotesSection from "@/components/OrderNotesSection";
import OrderReturnsSection from "@/components/OrderReturnsSection";
import EditOrderItemsModal from "@/components/EditOrderItemsModal";

// Matches backend EDITABLE_ORDER_STATUSES — items can only be changed before
// staff start physically preparing the order.
const EDITABLE_ITEM_STATUSES = ["pending", "confirmed"];

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = Number(params.id);
  const toast = useToast();

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkResult, setLinkResult] = useState<{ url: string; expiresAt: string } | null>(
    null,
  );
  const [editingItems, setEditingItems] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOrder(await getOrder(orderId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    }
  }, [orderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleStatusChange(status: OrderStatus) {
    try {
      await updateOrderStatus(orderId, status);
      toast(`Order moved to ${status.replace(/_/g, " ")}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this order? Any decremented stock will be restored.")) return;
    try {
      await cancelOrder(orderId);
      toast("Order cancelled");
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel order", "error");
    }
  }

  async function handleGenerateLink() {
    try {
      const result = await generatePaymentLink(orderId);
      setLinkResult(result);
      toast("Payment link generated");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to generate payment link", "error");
    }
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!order) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const canCancel = order.status !== "delivered" && order.status !== "cancelled";

  return (
    <PageShell variant="form">
      <BackButton href="/orders" />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Order #{order.id}</h1>
        <div className="flex gap-2">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.paymentStatus} />
        </div>
      </div>

      <Card className="mb-4">
        <h2 className="font-medium mb-2">Customer</h2>
        <p>{order.customerName}</p>
        <p className="text-sm text-text-muted">{order.customerPhone}</p>
        {order.customerEmail && (
          <p className="text-sm text-text-muted">{order.customerEmail}</p>
        )}
        <p className="text-sm mt-2">{order.customerAddress}</p>
        <p className="text-sm text-text-muted">
          {order.area ? `${order.area}, ` : ""}
          {order.emirate}
        </p>
      </Card>

      <Card className="mb-4">
        <h2 className="font-medium mb-2">Delivery</h2>
        <p className="text-sm">
          {order.deliveryDate
            ? new Date(order.deliveryDate).toLocaleDateString()
            : "No delivery date set"}
          {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
        </p>
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">Items</h2>
          {EDITABLE_ITEM_STATUSES.includes(order.status) && (
            <Button variant="secondary" size="sm" onClick={() => setEditingItems(true)}>
              Edit items
            </Button>
          )}
        </div>
        <table className="w-full text-sm">
          <tbody>
            {order.orderitem.map((item) => (
              <tr key={item.id} className="border-t border-gray-200 dark:border-white/10 first:border-t-0">
                <td className="py-2">
                  {item.productName}
                  {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                </td>
                <td className="py-2 text-text-muted">× {item.quantity}</td>
                <td className="py-2 text-right">{item.priceAtPurchase} AED</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 font-medium dark:border-white/10">
              <td className="py-2" colSpan={2}>
                Total
              </td>
              <td className="py-2 text-right">{order.total} AED</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      <Card className="mb-4">
        <h2 className="font-medium mb-3">Actions</h2>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="text-sm text-text-muted">Move to:</label>
          <select
            className="border border-border dark:border-white/15 rounded px-2 py-1 text-sm dark:bg-zinc-900 transition-colors hover:border-black/30 dark:hover:border-white/30 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            value=""
            disabled={!canCancel}
            onChange={(e) => e.target.value && handleStatusChange(e.target.value as OrderStatus)}
          >
            <option value="">Select status…</option>
            {getValidNextStatuses(order.status).map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          {canCancel && (
            <Button variant="danger" size="sm" onClick={handleCancel}>
              Cancel order
            </Button>
          )}
        </div>

        <div>
          <Button
            variant="primary"
            onClick={handleGenerateLink}
            disabled={order.paymentStatus === "paid" || order.status === "cancelled"}
          >
            Generate payment link
          </Button>
          {linkResult && (
            <p className="text-xs mt-2 break-all">
              <Link href={linkResult.url} className="underline" target="_blank">
                {linkResult.url}
              </Link>
              <span className="text-text-muted">
                {" "}
                (expires {new Date(linkResult.expiresAt).toLocaleString()})
              </span>
            </p>
          )}
        </div>
      </Card>

      <div className="mb-4">
        <OrderReturnsSection order={order} onChanged={refresh} />
      </div>

      <OrderNotesSection orderId={order.id} notes={order.ordernote ?? []} onAdded={refresh} />

      {editingItems && (
        <EditOrderItemsModal
          order={order}
          onClose={() => setEditingItems(false)}
          onSaved={(updated) => setOrder(updated)}
        />
      )}
    </PageShell>
  );
}
