"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { getTodaySnapshot } from "@/lib/api";
import type { TodaySnapshot } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";

// ANL-9. Reads the live endpoint, not the nightly rollups: the rollup job runs
// at 01:00 for YESTERDAY, so a rollup-backed card would be empty all day and
// then show the wrong day. Refreshes on the same 20s cadence the orders list
// already polls at, since "how is today going" is the one number a merchant
// watches change.
const REFRESH_MS = 20_000;

function money(value: number) {
  return `${value.toFixed(2)} AED`;
}

export default function TodayCard() {
  const { selectedOutletId } = useOutletFilter();
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getTodaySnapshot(selectedOutletId ?? undefined));
      setError(false);
    } catch {
      // A failed poll must not replace a good number with a zero - keep what is
      // on screen and mark it stale instead.
      setError(true);
    }
  }, [selectedOutletId]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!snapshot) {
    return (
      <Card className="mb-4">
        <Skeleton className="h-5 w-32 mb-3" />
        <Skeleton className="h-8 w-full" />
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Clock className="size-4 text-accent-text" />
          Today, live
        </h3>
        <span className="text-xs text-text-faint">
          {snapshot.date}
          {error && " (retrying)"}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-text-faint">Orders</p>
          <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
            {snapshot.orders}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-faint">Revenue</p>
          <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
            {money(snapshot.revenue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-faint">Due today, no slot</p>
          <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
            {snapshot.unslotted}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-faint">Cancelled</p>
          <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
            {snapshot.cancelledOrders}
          </p>
        </div>
      </div>

      {snapshot.slots.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-text-faint mb-2">
            Delivery slots booked for today
          </p>
          <div className="flex flex-wrap gap-2">
            {snapshot.slots.map((s) => (
              <span
                key={s.slot}
                className="rounded-full border border-border dark:border-white/15 px-3 py-1 text-xs text-text-secondary dark:text-zinc-400"
              >
                {s.slot}
                <span className="ml-1.5 font-semibold text-text-primary dark:text-zinc-100">
                  {s.orders}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {snapshot.orders === 0 && snapshot.cancelledOrders === 0 && (
        <p className="mt-3 text-xs text-text-faint">
          No orders yet today. This updates on its own as they come in.
        </p>
      )}
    </Card>
  );
}
