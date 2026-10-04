"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listAffiliateOrders, updateAffiliateOrderStatus } from "@/lib/api";
import type { AffiliateOrderListItem } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem } from "@/components/ui/CardList";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { useToast } from "@/components/ui/Toast";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;

const STATUS_CLASS: Record<string, string> = {
  approved: "text-green-600 dark:text-green-400",
  pending: "text-amber-600 dark:text-amber-400",
  blocked: "text-red-600 dark:text-red-400",
};

export default function AffiliateOrdersPage() {
  const toast = useToast();
  const [orders, setOrders] = useState<AffiliateOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<number | null>(null);

  // `latest` drops a response a newer refresh (page change) has superseded; a
  // failure ends in an error with Try again.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listAffiliateOrders({ page, pageSize: PAGE_SIZE })
      .then((res) => {
        if (mine !== latest.current) return;
        setOrders(res.data);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load affiliate orders");
      });
  }, [page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function decide(id: number, status: "approved" | "blocked") {
    setUpdating(id);
    try {
      await updateAffiliateOrderStatus(id, status);
      toast(`Commission ${status}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update commission status", "error");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <PageShell>
      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {orders !== null && orders.length > 0 && (
        <CardList>
          {orders.map((o) => (
            <CardListItem
              key={o.id}
              openLabel={`Order #${o.orderId}`}
              actions={
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-xs capitalize font-medium ${STATUS_CLASS[o.status] ?? ""}`}>{o.status}</span>
                  {o.status === "pending" && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="primary" disabled={updating === o.id} onClick={() => decide(o.id, "approved")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" disabled={updating === o.id} onClick={() => decide(o.id, "blocked")}>
                        Block
                      </Button>
                    </div>
                  )}
                </div>
              }
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">
                #{o.orderId} {o.customerName}
              </div>
              <div className="truncate text-xs text-text-muted">
                {o.affiliateName} ({o.code})
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                Order {o.orderTotal.toFixed(2)} · commission {o.commissionAmount.toFixed(2)}
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table stickyFirst className={orders !== null && orders.length > 0 ? "hidden md:block" : ""}>
        <THead>
          <tr>
            <TH>Order</TH>
            <TH>Affiliate / Code</TH>
            <TH>Order Total</TH>
            <TH>Commission</TH>
            <TH>Status</TH>
            <TH>Action</TH>
          </tr>
        </THead>
        <TBody>
          {orders === null ? (
            error ? (
              <tr>
                <td colSpan={6}>
                  <LoadFailed what="affiliate orders" onRetry={refresh} />
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={6}>
                  <TableSkeleton rows={8} cols={6} />
                </td>
              </tr>
            )
          ) : orders.length === 0 && !error ? (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  title="No affiliate orders yet"
                  description="Orders placed with a referral code will show up here."
                />
              </td>
            </tr>
          ) : (
            orders.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium">
                  #{o.orderId} <span className="text-text-muted font-normal">{o.customerName}</span>
                </TD>
                <TD className="text-text-muted">
                  {o.affiliateName} <span className="text-xs">({o.code})</span>
                </TD>
                <TD>{o.orderTotal.toFixed(2)}</TD>
                <TD className="font-medium">{o.commissionAmount.toFixed(2)}</TD>
                <TD className={`capitalize font-medium ${STATUS_CLASS[o.status] ?? ""}`}>{o.status}</TD>
                <TD>
                  {o.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={updating === o.id} onClick={() => decide(o.id, "approved")}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" disabled={updating === o.id} onClick={() => decide(o.id, "blocked")}>
                        Block
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-text-faint">-</span>
                  )}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {orders !== null && orders.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
