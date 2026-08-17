"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, Star, ClipboardList, Banknote, Users } from "lucide-react";
import { getDashboardSummary, getDailyRevenue, getTopProducts } from "@/lib/api";
import type { DashboardSummary, DailyRevenuePoint, TopProduct } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import DateRangePicker, { defaultDateRange, type DateRange } from "@/components/ui/DateRangePicker";
import StatCard from "@/components/ui/StatCard";
import SalesOverviewChart from "@/components/SalesOverviewChart";
import DonutChart, { SEGMENT_COLORS } from "@/components/ui/DonutChart";
import Thumbnail from "@/components/ui/Thumbnail";
import Skeleton, { CardSkeleton } from "@/components/ui/Skeleton";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import Card from "@/components/ui/Card";
import PageShell from "@/components/ui/PageShell";
import EmptyState from "@/components/ui/EmptyState";

const STAGES: { key: keyof DashboardSummary["ordersByStage"]; label: string }[] = [
  { key: "placed", label: "Placed" },
  { key: "accepted", label: "Accepted" },
  { key: "preparing", label: "Preparing" },
  { key: "shipped", label: "Shipped" },
  { key: "delivered", label: "Delivered" },
];

export default function DashboardPage() {
  const [range, setRange] = useState<DateRange>(() => defaultDateRange(30));
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [daily, setDaily] = useState<DailyRevenuePoint[] | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selectedOutletId } = useOutletFilter();

  useEffect(() => {
    setSummary(null);
    setDaily(null);
    setTopProducts(null);
    const params = { ...range, outletId: selectedOutletId ?? undefined };
    Promise.all([
      getDashboardSummary(params),
      getDailyRevenue(params),
      getTopProducts({ ...params, limit: 5 }),
    ])
      .then(([s, d, p]) => {
        setSummary(s);
        setDaily(d);
        setTopProducts(p);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [range, selectedOutletId]);

  const maxStage = useMemo(() => {
    if (!summary) return 1;
    return Math.max(1, ...STAGES.map((s) => summary.ordersByStage[s.key]));
  }, [summary]);

  if (error) return <p className="text-red-600">{error}</p>;

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/" />} right={<DateRangePicker value={range} onChange={setRange} />} />
      <h1 className="mb-6 text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Sales dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {!summary ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Avg Basket Value"
              value={`${summary.avgBasketValue.current.toFixed(2)} AED`}
              icon={<Wallet className="size-4" />}
              change={{ pct: summary.avgBasketValue.changePct }}
            />
            {/* No review/rating model exists in the schema — placeholder
                state rather than a fabricated score, per the feasibility
                check this dashboard rebuild started from. */}
            <StatCard
              label="Experience Rating"
              value="0.0"
              icon={<Star className="size-4" />}
              subtext="No reviews yet"
            />
            <StatCard
              label="Total Orders"
              value={String(summary.totalOrders)}
              icon={<ClipboardList className="size-4" />}
            />
            <StatCard
              label="Total Revenue"
              value={`${summary.revenue.current.toFixed(2)} AED`}
              icon={<Banknote className="size-4" />}
              change={{ pct: summary.revenue.changePct }}
            />
          </>
        )}
      </div>

      {/* Sale overview */}
      <Card className="mb-5">
        <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-5">Sale Overview</h2>
        {daily === null ? <Skeleton className="h-56 w-full" /> : <SalesOverviewChart data={daily} />}
      </Card>

      {/* Outlet / Sales activity / Customer growth */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-[18px]">Outlet Distribution</h2>
          {!summary ? (
            <Skeleton className="h-32 w-32 rounded-full mx-auto" />
          ) : summary.outlets.length === 0 ? (
            <EmptyState title="No outlets yet." />
          ) : (
            <div className="flex items-center gap-6">
              <DonutChart
                segments={summary.outlets.map((o) => ({ label: o.name, value: o.orderCount }))}
              />
              <div className="flex-1 space-y-2 min-w-0">
                {summary.outlets.map((o, i) => (
                  <div key={o.outletId} className="flex items-center justify-between text-sm gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`size-2.5 rounded-full shrink-0 ${SEGMENT_COLORS[i % SEGMENT_COLORS.length].bg}`}
                      />
                      <span className="truncate">{o.name}</span>
                    </span>
                    <span className="text-text-muted shrink-0">
                      {o.percentage.toFixed(0)}% · {o.orderCount}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50 mb-[18px]">Sales Activity</h2>
          {!summary ? (
            <div className="space-y-3">
              {STAGES.map((s) => (
                <Skeleton key={s.key} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {STAGES.map(({ key, label }) => {
                const count = summary.ordersByStage[key];
                return (
                  <div key={key}>
                    <div className="flex justify-between text-[13.5px] mb-1.5">
                      <span className="text-text-secondary dark:text-zinc-300">{label}</span>
                      <span className="font-bold text-text-primary dark:text-zinc-50">{count}</span>
                    </div>
                    <div className="h-[5px] rounded-full bg-border-light dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full transition-all"
                        style={{ width: `${(count / maxStage) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {!summary ? (
          <CardSkeleton />
        ) : (
          <StatCard
            label="Customer Growth"
            value={String(summary.customerGrowth.current)}
            icon={<Users className="size-4" />}
            subtext="new customers this period"
            change={{ pct: summary.customerGrowth.changePct }}
          />
        )}
      </div>

      {/* Channel distribution / Top products */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        <Card className="flex min-h-[200px] flex-col">
          <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Sales Distribution by Channel</h2>
          {!summary ? (
            <Skeleton className="h-32 w-full" />
          ) : summary.channels.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState title="No orders in this range." />
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <DonutChart
                segments={summary.channels.map((c) => ({ label: c.channel, value: c.count }))}
              />
              <div className="flex-1 space-y-2 min-w-0">
                {summary.channels.map((c, i) => (
                  <div key={c.channel} className="flex items-center justify-between text-sm gap-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`size-2.5 rounded-full shrink-0 ${SEGMENT_COLORS[i % SEGMENT_COLORS.length].bg}`}
                      />
                      <span className="truncate">{c.channel}</span>
                    </span>
                    <span className="text-text-muted shrink-0">
                      {c.percentage.toFixed(0)}% · {c.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="flex min-h-[200px] flex-col">
          <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">Top Selling Products</h2>
          {topProducts === null ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : topProducts.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState title="No sales in this range." />
            </div>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.productId} className="flex items-center gap-3">
                  <span className="text-xs text-text-faint w-4 text-right">{i + 1}</span>
                  <Thumbnail src={p.thumbnail} size="size-10" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-text-muted">{p.unitsSold} sold</div>
                  </div>
                  <div className="text-sm font-medium shrink-0">{p.revenue.toFixed(2)} AED</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
