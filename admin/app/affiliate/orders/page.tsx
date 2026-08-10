"use client";

import { useCallback, useEffect, useState } from "react";
import { listAffiliateOrders, updateAffiliateOrderStatus } from "@/lib/api";
import type { AffiliateOrderListItem } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
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

  const refresh = useCallback(async () => {
    try {
      const res = await listAffiliateOrders({ page, pageSize: PAGE_SIZE });
      setOrders(res.data);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load affiliate orders");
    }
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
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update commission status", "error");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <PageShell>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
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
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={8} cols={6} />
              </td>
            </tr>
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
                  #{o.orderId} <span className="text-zinc-500 font-normal">{o.customerName}</span>
                </TD>
                <TD className="text-zinc-500">
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
                    <span className="text-xs text-zinc-400">-</span>
                  )}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {orders !== null && orders.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-zinc-500">
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
