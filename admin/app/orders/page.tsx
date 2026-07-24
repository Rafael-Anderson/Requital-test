"use client";

import { useCallback, useEffect, useState } from "react";
import { cancelOrder, listOrders, updateOrderStatus } from "@/lib/api";
import { getNextAction, type Order } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useOutletFilter } from "@/lib/outlet-context";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import OrdersTabs from "@/components/OrdersTabs";
import OrderDetailModal from "@/components/OrderDetailModal";

const POLL_INTERVAL_MS = 20_000;

// No delivery date set is treated as "today" (immediately actionable),
// per product decision — a florist order with no explicit schedule is ASAP.
function isDueToday(deliveryDate: string | null): boolean {
  if (!deliveryDate) return true;
  const d = new Date(deliveryDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

interface Column {
  key: string;
  title: string;
  orders: Order[];
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const toast = useToast();
  const { selectedOutletId } = useOutletFilter();

  const refresh = useCallback(async () => {
    try {
      // ponytail: single page of live orders, no true pagination — fine at
      // this shop's current volume, revisit with a backend status-in filter
      // if the live-order count ever exceeds this.
      const result = await listOrders({
        pageSize: 100,
        outletId: selectedOutletId ?? undefined,
      });
      setOrders(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    }
  }, [selectedOutletId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleAdvance(order: Order) {
    const action = getNextAction(order.status);
    if (!action) return;
    try {
      await updateOrderStatus(order.id, action.next);
      toast(`Order #${order.id} moved to ${action.next.replace(/_/g, " ")}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  async function handleCancel(order: Order) {
    if (!confirm(`Cancel order #${order.id}? Any decremented stock will be restored.`)) return;
    try {
      await cancelOrder(order.id);
      toast(`Order #${order.id} cancelled`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel order", "error");
    }
  }

  const columns: Column[] = orders
    ? [
        { key: "new", title: "New Orders", orders: orders.filter((o) => o.status === "pending") },
        {
          key: "scheduled",
          title: "Scheduled",
          orders: orders.filter((o) => o.status === "confirmed" && !isDueToday(o.deliveryDate)),
        },
        {
          key: "preparing",
          title: "In Preparation",
          orders: orders.filter(
            (o) =>
              (o.status === "confirmed" && isDueToday(o.deliveryDate)) || o.status === "preparing",
          ),
        },
        {
          key: "delivery",
          title: "Out for Delivery/Ready",
          orders: orders.filter((o) => o.status === "out_for_delivery"),
        },
      ]
    : [];

  return (
    <div className="page-transition">
      <BackButton fallbackHref="/" />
      <h1 className="text-2xl font-semibold mb-1">Orders</h1>
      <OrdersTabs />

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {orders === null
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex-1 min-w-64">
                <CardSkeleton />
              </div>
            ))
          : columns.map((col) => (
              <div
                key={col.key}
                className="flex-1 min-w-64 border rounded-lg dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.02] p-3"
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-medium text-sm">{col.title}</h2>
                  <span className="text-xs font-medium bg-black text-white dark:bg-white dark:text-black rounded-full px-2 py-0.5 min-w-5 text-center">
                    {col.orders.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {col.orders.length === 0 && (
                    <p className="text-xs text-zinc-400 text-center py-8">No orders</p>
                  )}
                  {col.orders.map((order) => {
                    const nextAction = getNextAction(order.status);
                    const showAdvance =
                      nextAction && (order.status !== "confirmed" || isDueToday(order.deliveryDate));
                    return (
                      <div
                        key={order.id}
                        onClick={() => setSelectedOrderId(order.id)}
                        className="cursor-pointer rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 p-3 hover:border-black/30 dark:hover:border-white/30 transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-medium text-sm">#{order.id}</span>
                          <StatusBadge status={order.status} />
                        </div>
                        <div className="text-sm">{order.customerName}</div>
                        <div className="text-sm font-medium">{order.total} AED</div>
                        {order.deliveryDate && (
                          <div className="text-xs text-zinc-500 mt-1">
                            {new Date(order.deliveryDate).toLocaleDateString()}
                            {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
                          </div>
                        )}
                        <div className="text-xs text-zinc-400 mt-1">
                          Ordered {relativeTime(order.createdAt)}
                        </div>

                        <div className="flex gap-1.5 mt-3" onClick={(e) => e.stopPropagation()}>
                          {showAdvance && (
                            <Button size="sm" variant="primary" onClick={() => handleAdvance(order)}>
                              {nextAction!.label}
                            </Button>
                          )}
                          <Button size="sm" variant="danger" onClick={() => handleCancel(order)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
      </div>

      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onChanged={refresh}
      />
    </div>
  );
}
