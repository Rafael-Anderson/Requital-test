"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listDraftOrders } from "@/lib/api";
import { DRAFT_ORDER_STATUS_LABELS, type DraftOrder, type DraftOrderStatus } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";
import { formatMoney } from "@/lib/money";

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

  const placeholder =
    drafts === null && error ? (
      <LoadFailed what="draft orders" onRetry={refresh} />
    ) : drafts !== null && drafts.length === 0 && !error ? (
      <EmptyState title="No draft orders yet" description="Build an order on a customer's behalf to get started." />
    ) : null;

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Draft Orders</h1>
        <Link href="/orders/draft-orders/new">
          <Button variant="primary">
            <Plus className="size-4 inline -mt-0.5 me-1" />
            New draft order
          </Button>
        </Link>
      </div>
      <OrdersTabs />

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {drafts === null && !error ? (
        <CardListSkeleton rows={5} selectable={false} />
      ) : placeholder ? (
        <div className="rounded-2xl border border-border bg-surface md:hidden dark:border-white/10 dark:bg-zinc-900">
          {placeholder}
        </div>
      ) : (
        <CardList>
          {(drafts ?? []).map((d) => (
            <CardListItem
              key={d.id}
              href={`/orders/draft-orders/${d.id}`}
              openLabel={`Open draft order for ${d.customerName}`}
              actions={
                <span className={`text-xs font-medium ${STATUS_CLASS[d.status]}`}>{DRAFT_ORDER_STATUS_LABELS[d.status]}</span>
              }
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{d.customerName}</div>
              <div className="truncate text-xs text-text-muted">{d.customerPhone}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                <span className="font-bold text-text-primary dark:text-zinc-100">{formatMoney(d.total, d.currency)}</span>
                <span className="text-text-muted">
                  {d.items.length} item{d.items.length === 1 ? "" : "s"}
                </span>
                <span className="text-xs text-text-faint">{new Date(d.createdAt).toLocaleDateString()}</span>
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table className="hidden md:block">
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
          {drafts === null && !error ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={6} cols={5} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={5}>{placeholder}</td>
            </tr>
          ) : (
            (drafts ?? []).map((d) => (
              <TR key={d.id}>
                <TD>
                  <Link href={`/orders/draft-orders/${d.id}`} className="font-medium hover:underline">
                    {d.customerName}
                  </Link>
                  <div className="text-xs text-text-muted">{d.customerPhone}</div>
                </TD>
                <TD className="text-text-muted">{d.items.length} item{d.items.length === 1 ? "" : "s"}</TD>
                <TD>{formatMoney(d.total, d.currency)}</TD>
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
