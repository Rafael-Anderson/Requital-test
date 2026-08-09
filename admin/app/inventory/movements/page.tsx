"use client";

import { useCallback, useEffect, useState } from "react";
import { listStockMovements } from "@/lib/api";
import { ADJUSTMENT_REASON_LABELS, type StockMovement, type StockMovementType } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import InventoryTabs from "@/components/InventoryTabs";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;

const TYPE_LABEL: Record<StockMovementType, string> = {
  ADJUSTMENT: "Adjustment",
  TRANSFER: "Transfer",
};

function deltaLabel(m: StockMovement): string {
  const sign = m.delta > 0 ? "+" : m.delta < 0 ? "" : "";
  return `${sign}${m.delta}`;
}

export default function StockMovementsPage() {
  const { selectedOutletId } = useOutletFilter();
  const [movements, setMovements] = useState<StockMovement[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<StockMovementType | "">("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listStockMovements({
        page,
        pageSize: PAGE_SIZE,
        outletId: selectedOutletId ?? undefined,
        type: typeFilter || undefined,
      });
      setMovements(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load movement history");
    }
  }, [page, selectedOutletId, typeFilter]);

  useEffect(() => {
    setPage(1);
  }, [selectedOutletId, typeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/inventory" />} />
      <InventoryTabs />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Movement History</h1>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as StockMovementType | "")}
          className="border rounded px-3 py-1.5 text-sm dark:bg-zinc-900 transition-colors hover:border-black/30 dark:hover:border-white/30 cursor-pointer"
        >
          <option value="">All movements</option>
          <option value="ADJUSTMENT">Adjustments only</option>
          <option value="TRANSFER">Transfers only</option>
        </select>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Product / Ingredient</TH>
            <TH className="w-24">Type</TH>
            <TH className="w-36">Reason / Route</TH>
            <TH className="w-20">Qty</TH>
            <TH className="w-32">Branch</TH>
            <TH className="w-28">By</TH>
            <TH className="w-40">When</TH>
          </tr>
        </THead>
        <TBody>
          {movements === null ? (
            <tr>
              <td colSpan={7}>
                <TableSkeleton rows={8} cols={7} />
              </td>
            </tr>
          ) : movements.length === 0 && !error ? (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  title="No stock movements yet"
                  description="Adjustments and transfers you make will show up here."
                />
              </td>
            </tr>
          ) : (
            movements.map((m) => (
              <TR key={m.id}>
                <TD>
                  {m.ingredientId ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{m.ingredientName}</span>
                        <span className="inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-black/5 dark:bg-white/10 text-zinc-500">
                          Ingredient
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500">{m.ingredientUnit}</div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium">{m.productName}</div>
                      {m.variantLabel && <div className="text-xs text-zinc-500">{m.variantLabel}</div>}
                    </>
                  )}
                </TD>
                <TD className="text-zinc-500">{TYPE_LABEL[m.type]}</TD>
                <TD className="text-xs text-zinc-500">
                  {m.type === "ADJUSTMENT"
                    ? (m.reason && ADJUSTMENT_REASON_LABELS[m.reason]) ?? "—"
                    : m.toOutletName
                      ? `${m.outletName} → ${m.toOutletName}`
                      : // No destination outlet — a stock-in event (e.g. Scan to
                        // Stock) recorded as a TRANSFER row rather than an actual
                        // branch-to-branch move. Interpolating a null toOutletName
                        // straight into the string used to render the literal word
                        // "null" here.
                        `Received at ${m.outletName}`}
                  {m.note && <div className="mt-0.5 italic">&quot;{m.note}&quot;</div>}
                </TD>
                <TD className={m.delta < 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                  {deltaLabel(m)}
                </TD>
                <TD className="text-zinc-500">{m.type === "ADJUSTMENT" ? m.outletName : m.outletName}</TD>
                <TD className="text-zinc-500">{m.actorName}</TD>
                <TD className="text-xs text-zinc-500">{new Date(m.createdAt).toLocaleString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {movements !== null && movements.length > 0 && (
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
