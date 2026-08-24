"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listOrders } from "@/lib/api";
import { diffNewOrderIds, playOrderSound } from "@/lib/notification-sound";

// Matches the Orders kanban's own polling cadence (admin/app/orders/page.tsx)
// — this banner mirrors that page's data, so it doesn't need to be fresher
// than the page itself. No websocket/SSE infra exists anywhere in this app;
// polling is consistent with everything else here, not just simpler. Also
// the one app-wide poller Feature 7's sound notification reuses, rather
// than adding a second competing poll loop — pageSize widened from 1
// (count-only) to 50 so the actual order ids/names are available to diff
// against and to show in the notification, not just a total.
const POLL_INTERVAL_MS = 20_000;
const FETCH_PAGE_SIZE = 50;

interface NewOrder {
  id: number;
  customerName: string;
}

export default function NewOrderBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [newOrders, setNewOrders] = useState<NewOrder[]>([]);
  // null until the first poll completes — that first poll seeds this set
  // silently (every order in it already existed before this session
  // started watching), so the sound/notification only ever fires for an
  // order that shows up in a LATER poll it wasn't in.
  const seenIdsRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    // 'viewer' has no accept action (Orders status PATCH is admin/branch/
    // order_manager only) — a persistent "go accept this" banner makes no
    // sense for a role that structurally can't act on it.
    if (!user || user.role === "viewer") return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await listOrders({ status: "pending", pageSize: FETCH_PAGE_SIZE });
        if (cancelled) return;
        setPendingCount(res.total);

        const fetchedIds = res.data.map((o) => o.id);
        if (seenIdsRef.current === null) {
          seenIdsRef.current = new Set(fetchedIds);
          return;
        }
        const newIds = diffNewOrderIds(seenIdsRef.current, fetchedIds);
        if (newIds.length === 0) return;
        const arrived = res.data.filter((o) => newIds.includes(o.id));
        setNewOrders((prev) => [...prev, ...arrived.map((o) => ({ id: o.id, customerName: o.customerName }))]);
        playOrderSound();
      } catch {
        // Silent — a failed poll just leaves the last-known state showing;
        // this is a convenience banner, not a source of truth.
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user]);

  function dismiss(orderId: number) {
    setNewOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  function viewOrder(orderId: number) {
    dismiss(orderId);
    router.push(`/orders?orderId=${orderId}`);
  }

  if (!user || user.role === "viewer") return null;

  return (
    <>
      {pendingCount > 0 && (
        <div className="flex items-center justify-between gap-4 border-b border-accent/30 dark:border-accent/40 bg-accent/10 dark:bg-accent/15 px-6 py-2.5 text-sm text-accent-text dark:text-accent">
          <span>
            {pendingCount} new order{pendingCount === 1 ? "" : "s"} waiting to be accepted.
          </span>
          <Link href="/orders" className="shrink-0 font-medium hover:opacity-70">
            View orders
          </Link>
        </div>
      )}

      {/* Persistent — does not auto-dismiss, unlike the Toast system (which
          always auto-dismisses via a timeout, see Toast.tsx). Stays until
          the merchant explicitly views or dismisses each order. */}
      {newOrders.length > 0 && (
        <div className="fixed top-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)] space-y-2">
          <div className="rounded-lg border border-accent/30 dark:border-accent/40 bg-surface dark:bg-zinc-900 shadow-lg shadow-black/10">
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border dark:border-white/10">
              <span className="text-sm font-semibold">
                {newOrders.length === 1 ? "New order received" : `${newOrders.length} new orders received`}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border dark:divide-white/10">
              {newOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">Order #{order.id}</p>
                    <p className="text-xs text-text-muted truncate">{order.customerName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => viewOrder(order.id)}
                      className="text-xs font-medium text-accent-text dark:text-accent hover:opacity-70 cursor-pointer"
                    >
                      View order
                    </button>
                    <button
                      type="button"
                      onClick={() => dismiss(order.id)}
                      aria-label="Dismiss"
                      className="text-text-faint hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
