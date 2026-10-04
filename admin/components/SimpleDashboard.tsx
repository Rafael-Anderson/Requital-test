"use client";

import { useEffect, useState } from "react";
import { Wallet, ClipboardList, ShoppingBag } from "lucide-react";
import { getDashboardSummary, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { defaultDateRange } from "@/components/ui/DateRangePicker";
import StatCard from "@/components/ui/StatCard";
import { CardSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { formatMoney } from "@/lib/money";
import { useShopCurrency } from "@/lib/useShopCurrency";

// Simple-mode counterpart to the full DashboardPage (see admin/app/dashboard/
// page.tsx) — CLAUDE.md documents this as already shipped, but the file
// never existed (confirmed by grep during the QA audit that found this).
// Three stat cards only, pinned to today (no date-range picker, no charts),
// matching the same pared-down philosophy already applied to Orders/
// Customers in simple mode (see admin/lib/useShopMode.ts's own doc comment).
export default function SimpleDashboard() {
  const currency = useShopCurrency();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const { selectedOutletId } = useOutletFilter();

  // The two requests are independent: Revenue and Orders need the summary, the
  // Top Product card needs the product list; one failing or hanging never holds
  // the other on its skeleton. Each ends in an error with Try again.
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [reloadSummary, setReloadSummary] = useState(0);
  const [reloadTop, setReloadTop] = useState(0);

  useEffect(() => {
    let live = true;
    setSummary(null);
    getDashboardSummary({ ...defaultDateRange(1), outletId: selectedOutletId ?? undefined })
      .then((s) => {
        if (!live) return;
        setSummary(s);
        setSummaryError(null);
      })
      .catch((err) => {
        if (live) setSummaryError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      live = false;
    };
  }, [selectedOutletId, reloadSummary]);

  useEffect(() => {
    let live = true;
    setTopProducts(null);
    getTopProducts({ ...defaultDateRange(1), outletId: selectedOutletId ?? undefined, limit: 3 })
      .then((p) => {
        if (!live) return;
        setTopProducts(p);
        setTopError(null);
      })
      .catch((err) => {
        if (live) setTopError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      live = false;
    };
  }, [selectedOutletId, reloadTop]);

  const retrySummary = () => {
    setSummaryError(null);
    setReloadSummary((k) => k + 1);
  };
  const retryTop = () => {
    setTopError(null);
    setReloadTop((k) => k + 1);
  };

  const [topProduct, ...restProducts] = topProducts ?? [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {summary ? (
        <>
          <StatCard
            label="Revenue Today"
            value={formatMoney(summary.revenue.current, currency)}
            icon={<Wallet className="size-4" />}
          />
          <StatCard label="Orders Today" value={String(summary.totalOrders)} icon={<ClipboardList className="size-4" />} />
        </>
      ) : summaryError ? (
        <div className="sm:col-span-2">
          <LoadFailed what="today's figures" onRetry={retrySummary} />
        </div>
      ) : (
        <>
          <CardSkeleton />
          <CardSkeleton />
        </>
      )}
      {topProducts ? (
        <StatCard
          label="Top Product Today"
          value={topProduct ? topProduct.name : "No sales yet"}
          subtext={restProducts.length > 0 ? `Also: ${restProducts.map((p) => p.name).join(", ")}` : undefined}
          icon={<ShoppingBag className="size-4" />}
        />
      ) : topError ? (
        <LoadFailed what="the top product" onRetry={retryTop} />
      ) : (
        <CardSkeleton />
      )}
    </div>
  );
}
