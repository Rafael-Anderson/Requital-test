"use client";

import Link from "next/link";
import { Search, ClipboardList, Wallet, CreditCard, Truck } from "lucide-react";
import type { GeneralReportOrderRow, GeneralReportSummary } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton, CardSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import StatCard from "@/components/ui/StatCard";
import StatusBadge from "@/components/StatusBadge";

function formatPaymentMode(method: string | null): string {
  if (!method) return "-";
  return method
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Shared by General Report and Monthly Report — identical stat cards, order
// table, and pagination; only the filter bar's date control differs between
// the two pages (see ReportsFilterBar's `dateControl` slot). Purely
// presentational — the owning page fetches data and owns filter/pagination
// state.
export default function GeneralReportView({
  summary,
  orders,
  error,
  searchInput,
  onSearchInputChange,
  search,
  page,
  pageSize,
  total,
  onPrevPage,
  onNextPage,
}: {
  summary: GeneralReportSummary | null;
  orders: GeneralReportOrderRow[] | null;
  error: string | null;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  search: string;
  page: number;
  pageSize: number;
  total: number;
  onPrevPage: () => void;
  onNextPage: () => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

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
              label="Total Orders"
              value={String(summary.totalOrders)}
              icon={<ClipboardList className="size-4" />}
              subtext="Total orders from sales."
            />
            <StatCard
              label="Grand Total"
              value={`${summary.grandTotal.toFixed(2)} AED`}
              icon={<Wallet className="size-4" />}
              subtext="Grand total from orders."
            />
            <StatCard
              label="Total Payments"
              value={`${summary.totalPayments.toFixed(2)} AED`}
              icon={<CreditCard className="size-4" />}
              subtext="Total payments without delivery fee."
            />
            <StatCard
              label="Total Delivery Fee"
              value={`${summary.totalDeliveryFee.toFixed(2)} AED`}
              icon={<Truck className="size-4" />}
              subtext="Total delivery fee with orders."
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-end mb-4">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            placeholder="Search…"
            className="w-full h-9 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-[13.5px] outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Order Reference No</TH>
            <TH>Outlet</TH>
            <TH>Status</TH>
            <TH>Customer</TH>
            <TH>Type</TH>
            <TH>Payment Mode</TH>
            <TH>Grand Total</TH>
            <TH>Channel</TH>
            <TH>Order Time</TH>
          </tr>
        </THead>
        <TBody>
          {orders === null ? (
            <tr>
              <td colSpan={9}>
                <TableSkeleton rows={8} cols={9} />
              </td>
            </tr>
          ) : orders.length === 0 && !error ? (
            <tr>
              <td colSpan={9}>
                <EmptyState
                  title={search ? "No matching orders" : "No orders yet"}
                  description={search ? "Try a different search term." : "Orders matching these filters will show up here."}
                />
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <TR key={order.id}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">#{order.id}</TD>
                <TD className="text-text-muted text-[13.5px]">{order.outletName}</TD>
                <TD>
                  <StatusBadge status={order.status} />
                </TD>
                <TD>
                  {order.customerId ? (
                    <Link href={`/customers/${order.customerId}`} className="text-accent-text dark:text-accent hover:underline">
                      {order.customerName}
                    </Link>
                  ) : (
                    <span>{order.customerName}</span>
                  )}
                  <div className="text-xs text-text-faint">{order.customerPhone}</div>
                </TD>
                <TD className="capitalize text-text-muted text-[13.5px]">{order.orderType ?? "-"}</TD>
                <TD className="text-text-muted text-[13.5px]">{formatPaymentMode(order.paymentMethod)}</TD>
                <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">{order.total} AED</TD>
                <TD className="text-text-muted text-[13.5px]">{order.channel ?? "-"}</TD>
                <TD className="text-xs text-text-faint">{new Date(order.createdAt).toLocaleString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {orders !== null && orders.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[13px] text-text-faint">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={onPrevPage}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={onNextPage}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
