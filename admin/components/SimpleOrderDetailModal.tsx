"use client";

import { useEffect, useState } from "react";
import { cancelOrder, collectCash, getOrder, updateOrderStatus } from "@/lib/api";
import { getNextAction, type Order } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { waLink } from "@/lib/validators";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import Modal from "@/components/ui/Modal";

// Simple-mode counterpart to OrderDetailModal.tsx: status + basic info +
// items + Mark Fulfilled/Cancel only, none of the advanced sections (Status
// Timeline, Internal Notes, Returns, Customer detail, Inventory/external
// delivery, Order Editing). A separate component rather than a conditional
// branch inside OrderDetailModal — that file already has no internal
// tab/section abstraction to hook a "simple" flag into, so branching would
// mean scattering `mode === 'simple'` checks through most of its sections.
export default function SimpleOrderDetailModal({
  orderId,
  onClose,
  onChanged,
}: {
  orderId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectingCash, setCollectingCash] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (orderId === null) return;
    setOrder(null);
    setError(null);
    getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load order"));
  }, [orderId]);

  if (orderId === null) return null;

  async function handleCollectCash() {
    if (!order) return;
    setCollectingCash(true);
    try {
      await collectCash(order.id);
      toast("Cash collected");
      onChanged?.();
      setOrder(await getOrder(order.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to mark cash collected", "error");
    } finally {
      setCollectingCash(false);
    }
  }

  async function handleAdvance() {
    if (!order) return;
    const action = getNextAction(order.status);
    if (!action) return;
    if (action.next === "delivered" && order.paymentMethod === "cash_on_delivery" && !order.cashCollectedAt) return;
    try {
      await updateOrderStatus(order.id, action.next);
      toast(`Order #${order.id} moved to ${action.next.replace(/_/g, " ")}`);
      onChanged?.();
      setOrder(await getOrder(order.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleCancel() {
    if (!order) return;
    if (!confirm(`Cancel order #${order.id}? Any decremented stock will be restored.`)) return;
    try {
      await cancelOrder(order.id);
      toast(`Order #${order.id} cancelled`);
      onChanged?.();
      setOrder(await getOrder(order.id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel order", "error");
    }
  }

  const nextAction = order ? getNextAction(order.status) : null;
  const canCancel = order && order.status !== "delivered" && order.status !== "cancelled";
  const isCod = order?.paymentMethod === "cash_on_delivery";
  const cashUncollected = isCod && !order?.cashCollectedAt;
  const advanceBlockedByCash = nextAction?.next === "delivered" && cashUncollected;

  return (
    <Modal
      onClose={onClose}
      size="md"
      title={
        order ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span>Order #{order.id}</span>
            <StatusBadge status={order.status} />
          </div>
        ) : (
          "Order details"
        )
      }
      footer={
        order && (nextAction || canCancel)
          ? () => (
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {advanceBlockedByCash && (
                  <p className="text-xs text-text-faint">Mark cash collected before completing this order.</p>
                )}
                {canCancel && (
                  <Button variant="danger" onClick={handleCancel}>
                    Cancel order
                  </Button>
                )}
                {nextAction && (
                  <Button variant="primary" onClick={handleAdvance} disabled={advanceBlockedByCash}>
                    {nextAction.label}
                  </Button>
                )}
              </div>
            )
          : undefined
      }
    >
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {!order ? (
        <div className="space-y-4 pb-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-text-muted">
            <div className="font-medium text-zinc-800 dark:text-zinc-200">{order.customerName}</div>
            <div>
              <a
                href={waLink(order.customerPhone)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent-text dark:hover:text-accent hover:underline"
              >
                {order.customerPhone}
              </a>
            </div>
            {order.deliveryDate && (
              <div className="mt-1 font-medium text-zinc-700 dark:text-zinc-300">
                Due {new Date(order.deliveryDate).toLocaleDateString()}
                {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
              </div>
            )}
            <div className="mt-1">Placed {relativeTime(order.createdAt)}</div>
          </div>

          {isCod && (
            <div className="flex items-center justify-between text-sm border border-gray-200 rounded-lg p-3 dark:border-white/10">
              <span className="text-text-muted">Cash on delivery</span>
              {order.cashCollectedAt ? (
                <span className="text-green-700 dark:text-green-400 font-medium text-xs">
                  Collected ✓ {new Date(order.cashCollectedAt).toLocaleString()}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCollectCash}
                  disabled={collectingCash}
                  loading={collectingCash}
                >
                  Mark cash collected
                </Button>
              )}
            </div>
          )}

          <section className="border border-gray-200 rounded-lg p-4 dark:border-white/10">
            <h3 className="font-medium mb-3">Order items</h3>
            <div className="space-y-3">
              {order.orderitem.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <Thumbnail src={item.product?.thumbnail} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {item.productName}
                      {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    </div>
                    <div className="text-xs text-text-muted">
                      {item.quantity} × {item.priceAtPurchase} AED
                    </div>
                  </div>
                  <div className="text-sm font-medium">
                    {(Number(item.priceAtPurchase) * item.quantity).toFixed(2)} AED
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm font-medium border-t border-gray-200 dark:border-white/10 mt-3 pt-3">
              <span>Total</span>
              <span>{order.total} AED</span>
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
