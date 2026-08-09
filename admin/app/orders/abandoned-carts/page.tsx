"use client";

import { useEffect, useState } from "react";
import { listAbandonedCarts } from "@/lib/api";
import type { AbandonedCart } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function AbandonedCartsPage() {
  const [carts, setCarts] = useState<AbandonedCart[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAbandonedCarts()
      .then(setCarts)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load abandoned carts"));
  }, []);

  return (
    <PageShell>
      <BackButton href="/orders" />
      <OrdersTabs />
      <h1 className="text-2xl font-semibold mb-1">Abandoned Carts</h1>
      <p className="text-sm text-zinc-500 mb-4">
        Shoppers who started checkout but didn&apos;t complete an order. Turn on recovery emails in Settings &gt;
        Business Information.
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Contact</TH>
            <TH className="w-28">Cart value</TH>
            <TH className="w-28">Abandoned</TH>
            <TH className="w-32">Recovery email</TH>
            <TH className="w-24">Recovered</TH>
          </tr>
        </THead>
        <TBody>
          {carts === null ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={3} cols={5} />
              </td>
            </tr>
          ) : carts.length === 0 ? (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  title="No abandoned carts yet"
                  description="Shoppers who enter their contact info at checkout but don't complete an order will show up here."
                />
              </td>
            </tr>
          ) : (
            carts.map((c) => (
              <TR key={c.id}>
                <TD>
                  <p className="font-medium">{c.customerName}</p>
                  <p className="text-xs text-zinc-500">{c.customerEmail ?? c.customerPhone}</p>
                </TD>
                <TD className="text-zinc-500">{c.cartValue}</TD>
                <TD className="text-zinc-500" title={new Date(c.capturedAt).toLocaleString()}>
                  {timeAgo(c.capturedAt)}
                </TD>
                <TD>
                  {c.recoveryEmailSentAt ? (
                    <span className="text-xs rounded px-2 py-1 border border-green-400 text-green-700 dark:text-green-400">
                      Sent
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">Not yet</span>
                  )}
                </TD>
                <TD>
                  {c.recoveredOrderId ? (
                    <span className="text-xs rounded px-2 py-1 border border-green-400 text-green-700 dark:text-green-400">
                      Yes (#{c.recoveredOrderId})
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-400">No</span>
                  )}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
