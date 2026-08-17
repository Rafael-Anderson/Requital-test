"use client";

import { useEffect, useState } from "react";
import { getOrderHistory } from "@/lib/api";
import type { OrderHistoryEntry, OrderStatus } from "@/lib/types";

// "pending" only ever appears once, as the synthesized first entry (see
// backend OrdersService.getHistory) — "Order Placed" reads better there
// than "Pending" would.
const TIMELINE_LABELS: Record<OrderStatus, string> = {
  pending: "Order Placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// Mapped straight off the CAS order state machine's own real transitions
// (backend OrdersService.updateStatus/.cancel, both audit-logged) — not a
// separate parallel status system. Re-fetches whenever `refreshKey`
// changes, so the caller can bump it after any action that might move the
// order (advance/cancel).
export default function OrderStatusTimeline({ orderId, refreshKey }: { orderId: number; refreshKey: number }) {
  const [history, setHistory] = useState<OrderHistoryEntry[] | null>(null);

  useEffect(() => {
    getOrderHistory(orderId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [orderId, refreshKey]);

  if (!history || history.length === 0) return null;

  return (
    <section className="border border-border rounded-lg p-4 dark:border-white/10 mb-4">
      <h3 className="font-medium mb-3">Status timeline</h3>
      <ol>
        {history.map((entry, i) => (
          <li key={i} className="relative pl-6 pb-4 last:pb-0">
            {i < history.length - 1 && (
              <span className="absolute left-[5px] top-3.5 bottom-0 w-px bg-black/10 dark:bg-white/15" aria-hidden="true" />
            )}
            <span className="absolute left-0 top-1 size-2.5 rounded-full bg-accent" aria-hidden="true" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">
                {entry.status ? (TIMELINE_LABELS[entry.status] ?? entry.status.replace(/_/g, " ")) : "Unknown"}
              </span>
              <span className="text-xs text-text-faint whitespace-nowrap">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
            {entry.actorName && <p className="text-xs text-text-muted mt-0.5">by {entry.actorName}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
