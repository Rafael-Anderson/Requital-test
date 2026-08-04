"use client";

import { useEffect, useState } from "react";
import { Wallet, ClipboardList } from "lucide-react";
import { getDashboardSummary, getTopProducts } from "@/lib/api";
import type { DashboardSummary, TopProduct } from "@/lib/types";
import { defaultDateRange } from "@/components/ui/DateRangePicker";
import { useOutletFilter } from "@/lib/outlet-context";
import StatCard from "@/components/ui/StatCard";
import Thumbnail from "@/components/ui/Thumbnail";
import Card from "@/components/ui/Card";
import Skeleton, { CardSkeleton } from "@/components/ui/Skeleton";

// Simple-mode counterpart to DashboardPage: today only, no date range picker
// (no week/month toggle), no chart/outlet/channel breakdowns, no low-stock
// or abandoned-cart widgets — those don't exist on this dashboard today
// (they live on their own pages), so there was nothing to hide there, just
// the range/chart/breakdown surface this page already has.
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

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {!summary ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Revenue Today"
              value={`${summary.revenue.current.toFixed(2)} AED`}
              icon={<Wallet className="size-4" />}
              change={{ pct: summary.revenue.changePct }}
            />
            <StatCard
              label="Orders Today"
              value={String(summary.totalOrders)}
              icon={<ClipboardList className="size-4" />}
            />
          </>
        )}

        <Card className="sm:col-span-2 lg:col-span-1">
          <h2 className="font-medium mb-4">Top 3 Products</h2>
          {topProducts === null ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : topProducts.length === 0 ? (
            <p className="text-sm text-zinc-400">No sales today.</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.productId} className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400 w-4 text-right">{i + 1}</span>
                  <Thumbnail src={p.thumbnail} size="size-10" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-zinc-500">{p.unitsSold} sold</div>
                  </div>
                  <div className="text-sm font-medium shrink-0">{p.revenue.toFixed(2)} AED</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
