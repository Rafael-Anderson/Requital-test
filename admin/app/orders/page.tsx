"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cancelOrder, collectCash, listOrders, updateOrderStatus } from "@/lib/api";
import { getNextAction, type Order } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { useOutletFilter } from "@/lib/outlet-context";
import { useShopMode } from "@/lib/useShopMode";
import StatusBadge from "@/components/StatusBadge";
import Button from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import OrderDetailModal from "@/components/OrderDetailModal";
import SimpleOrderDetailModal from "@/components/SimpleOrderDetailModal";
import PageShell from "@/components/ui/PageShell";

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
  return (
    <Suspense fallback={null}>
      <OrdersPageContent />
    </Suspense>
  );
}

// useSearchParams() (for the ?orderId= deep link) requires a Suspense
// boundary in Next 16 — same wrapper shape as app/products/page.tsx's own
// InventoryPage/InventoryPageContent split.
function OrdersPageContent() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const toast = useToast();
  const { selectedOutletId } = useOutletFilter();
  const mode = useShopMode();
  const isSimple = mode === "simple";
  const searchParams = useSearchParams();

  // Deep-link from NewOrderBanner's "View order" action
  // (/orders?orderId=123) — opens the detail modal for that order directly
  // instead of just landing on the list.
  useEffect(() => {
    const orderId = searchParams.get("orderId");
    if (orderId) setSelectedOrderId(Number(orderId));
  }, [searchParams]);

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

  async function handleCollectCash(order: Order) {
    try {
      await collectCash(order.id);
      toast(`Cash collected for order #${order.id}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to mark cash collected", "error");
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
    <PageShell>
      <BranchBar left={<BackButton href="/" />} />
      <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50 mb-[18px]">Orders</h1>
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
                className="flex-1 min-w-64 rounded-2xl bg-[#EFF1F0] dark:bg-white/[0.03] dark:border dark:border-white/10 p-4"
              >
                <div className="flex items-center justify-between mb-3.5">
                  <h2 className="text-[13.5px] font-bold text-text-primary dark:text-zinc-50">{col.title}</h2>
                  <span className="text-[11.5px] font-bold bg-text-primary text-white dark:bg-white dark:text-black rounded-full px-2 py-0.5 min-w-5 text-center">
                    {col.orders.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {col.orders.length === 0 && (
                    <p className="text-[13px] text-text-faint text-center py-8">No orders</p>
                  )}
                  {col.orders.map((order) => {
                    const nextAction = getNextAction(order.status);
                    const showAdvance = !!nextAction;
                    const isCod = order.paymentMethod === "cash_on_delivery";
                    return (
                      <div
                        key={order.id}
                        onClick={() => setSelectedOrderId(order.id)}
                        className="cursor-pointer rounded-xl border border-border dark:border-white/10 bg-surface dark:bg-zinc-900 p-3.5 hover:border-accent-mid hover:shadow-[0_6px_18px_rgba(15,23,22,.07)] transition-[border-color,box-shadow] duration-150"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[13.5px] font-bold text-text-primary dark:text-zinc-50">#{order.id}</span>
                          <StatusBadge status={order.status} />
                        </div>
                        <div className="text-[13.5px] text-text-secondary dark:text-zinc-300">{order.customerName}</div>
                        <div className="text-sm font-bold text-text-primary dark:text-zinc-50">{order.total} AED</div>
                        {order.deliveryDate && (
                          <div className="text-xs text-text-muted mt-1">
                            {new Date(order.deliveryDate).toLocaleDateString()}
                            {order.deliveryTimeSlot ? ` · ${order.deliveryTimeSlot}` : ""}
                          </div>
                        )}
                        {!isSimple && (
                          <div className="text-xs text-text-faint mt-1">
                            Ordered {relativeTime(order.createdAt)}
                          </div>
                        )}
                        {!isSimple && order.orderitem.some((item) => item.note) && (
                          <div className="mt-1.5 space-y-0.5">
                            {order.orderitem
                              .filter((item) => item.note)
                              .map((item) => (
                                <p key={item.id} className="text-xs italic text-amber-600 dark:text-amber-400 truncate">
                                  Customer ({item.productName}): {item.note}
                                </p>
                              ))}
                          </div>
                        )}

                        {isCod && order.cashCollectedAt && (
                          <div className="mt-1.5">
                            <span className="text-[11px] font-medium text-green-700 dark:text-green-400">
                              Cash collected ✓
                            </span>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                          {showAdvance && (
                            <Button size="sm" variant="primary" className="flex-1" onClick={() => handleAdvance(order)}>
                              {nextAction!.label}
                            </Button>
                          )}
                          {isCod && !order.cashCollectedAt && (
                            <Button size="sm" variant="secondary" onClick={() => handleCollectCash(order)}>
                              Mark cash collected
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

      {isSimple ? (
        <SimpleOrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onChanged={refresh}
        />
      ) : (
        <OrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onChanged={refresh}
        />
      )}
    </PageShell>
  );
}
