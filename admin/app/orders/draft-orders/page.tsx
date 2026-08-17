"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listDraftOrders } from "@/lib/api";
import { DRAFT_ORDER_STATUS_LABELS, type DraftOrder, type DraftOrderStatus } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";

const STATUS_CLASS: Record<DraftOrderStatus, string> = {
  OPEN: "text-text-secondary dark:text-zinc-400",
  INVOICE_SENT: "text-amber-600 dark:text-amber-400",
  COMPLETED: "text-green-600 dark:text-green-400",
  CANCELLED: "text-red-600 dark:text-red-400",
};

export default function DraftOrdersPage() {
  const [drafts, setDrafts] = useState<DraftOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDrafts(await listDraftOrders());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft orders");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <PageShell>
      <BackButton href="/orders" />
      <OrdersTabs />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Draft Orders</h1>
        <Link href="/orders/draft-orders/new">
          <Button variant="primary">
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            New draft order
          </Button>
        </Link>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Customer</TH>
            <TH>Items</TH>
            <TH className="w-24">Total</TH>
            <TH className="w-28">Status</TH>
            <TH className="w-32">Date</TH>
          </tr>
        </THead>
        <TBody>
          {drafts === null ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={6} cols={5} />
              </td>
            </tr>
          ) : drafts.length === 0 && !error ? (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  title="No draft orders yet"
                  description="Build an order on a customer's behalf to get started."
                />
              </td>
            </tr>
          ) : (
            drafts.map((d) => (
              <TR key={d.id}>
                <TD>
                  <Link href={`/orders/draft-orders/${d.id}`} className="font-medium hover:underline">
                    {d.customerName}
                  </Link>
                  <div className="text-xs text-text-muted">{d.customerPhone}</div>
                </TD>
                <TD className="text-text-muted">{d.items.length} item{d.items.length === 1 ? "" : "s"}</TD>
                <TD>{d.total.toFixed(2)} AED</TD>
                <TD className={`font-medium ${STATUS_CLASS[d.status]}`}>{DRAFT_ORDER_STATUS_LABELS[d.status]}</TD>
                <TD className="text-xs text-text-muted">{new Date(d.createdAt).toLocaleDateString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
