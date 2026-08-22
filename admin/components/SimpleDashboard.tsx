"use client";

import { useEffect, useState } from "react";
import { Wallet, ClipboardList, ShoppingBag } from "lucide-react";
import { getDashboardSummary, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { defaultDateRange } from "@/components/ui/DateRangePicker";
import StatCard from "@/components/ui/StatCard";
import { CardSkeleton } from "@/components/ui/Skeleton";

// Simple-mode counterpart to the full DashboardPage (see admin/app/dashboard/
// page.tsx) — CLAUDE.md documents this as already shipped, but the file
// never existed (confirmed by grep during the QA audit that found this).
// Three stat cards only, pinned to today (no date-range picker, no charts),
// matching the same pared-down philosophy already applied to Orders/
// Customers in simple mode (see admin/lib/useShopMode.ts's own doc comment).
export default function SimpleDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selectedOutletId } = useOutletFilter();

  useEffect(() => {
    setSummary(null);
    setTopProducts(null);
    const params = { ...defaultDateRange(1), outletId: selectedOutletId ?? undefined };
    Promise.all([getDashboardSummary(params), getTopProducts({ ...params, limit: 3 })])
      .then(([s, p]) => {
        setSummary(s);
        setTopProducts(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [selectedOutletId]);

  if (error) return <p className="text-red-600">{error}</p>;

  if (!summary || !topProducts) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const [topProduct, ...restProducts] = topProducts;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard
        label="Revenue Today"
        value={`${summary.revenue.current.toLocaleString()} AED`}
        icon={<Wallet className="size-4" />}
      />
      <StatCard label="Orders Today" value={String(summary.totalOrders)} icon={<ClipboardList className="size-4" />} />
      <StatCard
        label="Top Product Today"
        value={topProduct ? topProduct.name : "No sales yet"}
        subtext={restProducts.length > 0 ? `Also: ${restProducts.map((p) => p.name).join(", ")}` : undefined}
        icon={<ShoppingBag className="size-4" />}
      />
    </div>
  );
}
