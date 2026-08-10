"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listOrders } from "@/lib/api";

// Matches the Orders kanban's own polling cadence (admin/app/orders/page.tsx)
// — this banner mirrors that page's data, so it doesn't need to be fresher
// than the page itself. No websocket/SSE infra exists anywhere in this app;
// polling is consistent with everything else here, not just simpler.
const POLL_INTERVAL_MS = 20_000;

// Persistent, app-wide "new orders waiting" banner — stays up until the
// merchant accepts every pending order (order.status: pending -> confirmed,
// the kanban's existing Accept action). No dismiss control, unlike
// EmailVerificationBanner: this one is meant to persist until the
// underlying condition actually clears.
export default function NewOrderBanner() {
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    // 'viewer' has no accept action (Orders status PATCH is admin/branch/
    // order_manager only) — a persistent "go accept this" banner makes no
    // sense for a role that structurally can't act on it.
    if (!user || user.role === "viewer") return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await listOrders({ status: "pending", pageSize: 1 });
        if (!cancelled) setPendingCount(res.total);
      } catch {
        // Silent — a failed poll just leaves the last-known count showing;
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

  if (!user || user.role === "viewer" || pendingCount === 0) return null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-accent/30 dark:border-accent/40 bg-accent/10 dark:bg-accent/15 px-6 py-2.5 text-sm text-accent-text dark:text-accent">
      <span>
        {pendingCount} new order{pendingCount === 1 ? "" : "s"} waiting to be accepted.
      </span>
      <Link href="/orders" className="shrink-0 font-medium hover:opacity-70">
        View orders
      </Link>
    </div>
  );
}
