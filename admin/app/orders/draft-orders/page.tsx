"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listDraftOrders } from "@/lib/api";
import {
  DRAFT_ORDER_FILTERS,
  DRAFT_ORDER_STATUS_LABELS,
  type DraftOrderStatus,
  type PaginatedDraftOrders,
} from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Pagination, { DEFAULT_PAGE_SIZE } from "@/components/ui/Pagination";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";
import Money from "@/components/Money";

const STATUS_CLASS: Record<DraftOrderStatus, string> = {
  OPEN: "text-text-secondary dark:text-zinc-400",
  INVOICE_SENT: "text-amber-600 dark:text-amber-400",
  AWAITING_PAYMENT: "text-amber-700 dark:text-amber-300",
  COMPLETED: "text-green-600 dark:text-green-400",
  CANCELLED: "text-red-600 dark:text-red-400",
};

type FilterValue = (typeof DRAFT_ORDER_FILTERS)[number]["value"];

export default function DraftOrdersPage() {
  const [result, setResult] = useState<PaginatedDraftOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<FilterValue>("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // One request per filter state; a slower earlier answer never overwrites a newer one.
  useEffect(() => {
    const ticket = ++latest.current;
    listDraftOrders({ page, pageSize, status: status || undefined, search: debounced }).then(
      (res) => {
        if (ticket !== latest.current) return;
        setResult(res);
        setError(null);
      },
      (err) => {
        if (ticket !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load draft orders");
      },
    );
  }, [page, pageSize, status, debounced, reloadKey]);

  const drafts = result?.data ?? null;
  const placeholder =
    drafts === null && error ? (
      <LoadFailed what="draft orders" onRetry={() => setReloadKey((k) => k + 1)} />
    ) : drafts !== null && drafts.length === 0 ? (
      <EmptyState
        title={status || debounced ? "No draft orders match" : "No draft orders yet"}
        description="Build an order on a customer's behalf and send them a payment link."
      />
    ) : null;

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Draft Orders</h1>
        <Link href="/orders/draft-orders/new">
          <Button variant="primary">
            <Plus className="size-4 inline -mt-0.5 me-1" />
            Create order
          </Button>
        </Link>
      </div>
      <OrdersTabs />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SegmentedToggle
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={DRAFT_ORDER_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
        <Input
          label="Search"
          wrapperClassName="min-w-56 flex-1 sm:flex-none"
          placeholder="Customer name or phone"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

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
                {d.total !== null && (
                  <span className="font-bold text-text-primary dark:text-zinc-100">
                    <Money amount={d.total} currency={d.currency} />
                  </span>
                )}
                <span className="text-text-muted">
                  {d.itemCount} item{d.itemCount === 1 ? "" : "s"}
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
            <TH className="w-28">Total</TH>
            <TH className="w-36">Status</TH>
            <TH className="w-32">Created by</TH>
            <TH className="w-28">Date</TH>
          </tr>
        </THead>
        <TBody>
          {drafts === null && !error ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={6} cols={6} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={6}>{placeholder}</td>
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
                <TD className="text-text-muted">
                  {d.itemCount} item{d.itemCount === 1 ? "" : "s"}
                </TD>
                <TD>{d.total !== null ? <Money amount={d.total} currency={d.currency} /> : null}</TD>
                <TD className={`font-medium ${STATUS_CLASS[d.status]}`}>{DRAFT_ORDER_STATUS_LABELS[d.status]}</TD>
                <TD className="text-xs text-text-muted">{d.createdBy?.name ?? ""}</TD>
                <TD className="text-xs text-text-muted">{new Date(d.createdAt).toLocaleDateString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {result && result.total > 0 && (
        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          noun="draft orders"
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}
    </PageShell>
  );
}
