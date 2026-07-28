"use client";

import { useCallback, useEffect, useState } from "react";
import { listAuditLog, listAuditLogActors } from "@/lib/api";
import type { AuditLogEntry } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Logged in",
  "product.price_changed": "Changed price",
  "product.status_changed": "Changed status",
  "product.deleted": "Deleted product",
  "product.bulk_status_changed": "Bulk status change",
  "product.bulk_price_changed": "Bulk price change",
  "order.status_changed": "Changed order status",
  "category.deleted": "Deleted category",
  "discount.deleted": "Deleted discount",
  "biolink.deleted": "Deleted bio link",
};

const ENTITY_TYPES = ["auth", "product", "order", "category", "discount", "biolink"];

function describe(entry: AuditLogEntry): string {
  const before = entry.before as Record<string, unknown> | null;
  const after = entry.after as Record<string, unknown> | null;
  const metadata = entry.metadata as Record<string, unknown> | null;

  switch (entry.action) {
    case "product.price_changed":
      return `${before?.price ?? "?"} → ${after?.price ?? "?"} AED`;
    case "product.status_changed":
      return `${before?.status ?? "?"} → ${after?.status ?? "?"}`;
    case "product.deleted":
      return `"${before?.name ?? "?"}" (${before?.sku ?? "no sku"})`;
    case "product.bulk_status_changed":
      return `${(metadata?.updated as number) ?? "?"} product(s) → ${after?.status ?? "?"}`;
    case "product.bulk_price_changed": {
      const ids = metadata?.updated as number[] | undefined;
      return `${ids?.length ?? "?"} product(s), ${metadata?.field} ${metadata?.mode} ${metadata?.value}`;
    }
    case "order.status_changed":
      return `${before?.status ?? "?"} → ${after?.status ?? "?"}`;
    case "category.deleted":
      return `"${before?.name ?? "?"}"`;
    case "discount.deleted":
      return `"${before?.code ?? "?"}"`;
    case "biolink.deleted":
      return `"${before?.label ?? "?"}"`;
    default:
      return "";
  }
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [actors, setActors] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listAuditLog({
        page,
        pageSize: PAGE_SIZE,
        entityType: entityType || undefined,
        actorUserId: actorUserId ? Number(actorUserId) : undefined,
      });
      setEntries(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity log");
    }
  }, [page, entityType, actorUserId]);

  useEffect(() => {
    setPage(1);
  }, [entityType, actorUserId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    listAuditLogActors().then(setActors).catch(() => setActors([]));
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <BackButton href="/" />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Activity Log</h1>
        <div className="flex items-center gap-2">
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm dark:bg-zinc-900 transition-colors hover:border-black/30 dark:hover:border-white/30 cursor-pointer"
          >
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm dark:bg-zinc-900 transition-colors hover:border-black/30 dark:hover:border-white/30 cursor-pointer"
          >
            <option value="">All staff</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Action</TH>
            <TH>Entity</TH>
            <TH>Details</TH>
            <TH className="w-32">By</TH>
            <TH className="w-40">When</TH>
          </tr>
        </THead>
        <TBody>
          {entries === null ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={10} cols={5} />
              </td>
            </tr>
          ) : entries.length === 0 && !error ? (
            <tr>
              <td colSpan={5}>
                <EmptyState title="No activity yet" description="Meaningful admin actions will show up here." />
              </td>
            </tr>
          ) : (
            entries.map((e) => (
              <TR key={e.id}>
                <TD className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</TD>
                <TD className="text-zinc-500">
                  {e.entityType}
                  {e.entityId ? ` #${e.entityId}` : ""}
                </TD>
                <TD className="text-xs text-zinc-500">{describe(e)}</TD>
                <TD className="text-zinc-500">{e.actorName}</TD>
                <TD className="text-xs text-zinc-500">{new Date(e.createdAt).toLocaleString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {entries !== null && entries.length > 0 && (
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
