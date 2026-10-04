"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteSupplier, listSuppliers, updateSupplier } from "@/lib/api";
import type { Supplier, SupplierListItem } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { formatMoney } from "@/lib/money";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import Select from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardRowMenu } from "@/components/ui/CardList";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import InventoryTabs from "@/components/InventoryTabs";
import StatusBadge from "@/components/StatusBadge";
import SupplierFormModal from "@/components/SupplierFormModal";

const ICON_BTN =
  "p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer";
const DANGER_BTN =
  "p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer";

export default function SuppliersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "admin";
  const [suppliers, setSuppliers] = useState<SupplierListItem[] | null>(null);
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteWithUndo = useUndoableDelete();

  // Bumping `version` re-runs the fetch effect; the setters live in promise
  // callbacks, not the effect body.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    listSuppliers(filter === "all" ? undefined : filter)
      .then((rows) => {
        if (!live) return;
        setSuppliers(rows);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load suppliers");
      });
    return () => {
      live = false;
    };
  }, [filter, version]);

  async function setStatus(s: SupplierListItem, status: "active" | "archived") {
    try {
      await updateSupplier(s.id, { status });
      toast(status === "archived" ? `"${s.name}" archived` : `"${s.name}" restored`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update supplier", "error");
    }
  }

  function handleDelete(s: SupplierListItem) {
    deleteWithUndo({
      id: s.id,
      label: `"${s.name}"`,
      onRemoveLocally: () => setSuppliers((prev) => (prev ? prev.filter((x) => x.id !== s.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteSupplier(s.id).then(() => refresh()),
    });
  }

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory" />
      <InventoryTabs />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Suppliers</h1>
        <div className="flex items-center gap-3">
          <Select
            aria-label="Filter suppliers"
            value={filter}
            onChange={(e) => setFilter(e.target.value as "active" | "archived" | "all")}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
          {isAdmin && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="-mt-0.5 me-1 inline size-4" />
              New supplier
            </Button>
          )}
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {suppliers === null ? (
        error ? <LoadFailed what="suppliers" onRetry={refresh} /> : <TableSkeleton rows={4} cols={5} />
      ) : suppliers.length === 0 ? (
        <EmptyState
          title="No suppliers yet"
          description="Add the people you buy flowers, packaging and other stock from, with their terms and prices."
        />
      ) : (
        <>
        {/* Below md one tappable card per supplier (tap opens it); md and up the table. */}
        <CardList>
          {suppliers.map((s) => (
            <CardListItem
              key={s.id}
              href={`/inventory/suppliers/${s.id}`}
              openLabel={`Open ${s.name}`}
              actions={
                isAdmin ? (
                  <CardRowMenu
                    label={`More actions for ${s.name}`}
                    items={[
                      { label: "Edit", icon: <Pencil className="size-3.5" />, onClick: () => setEditing(s) },
                      s.status === "active"
                        ? { label: "Archive", icon: <Archive className="size-3.5" />, onClick: () => setStatus(s, "archived") }
                        : { label: "Restore", icon: <ArchiveRestore className="size-3.5" />, onClick: () => setStatus(s, "active") },
                      { label: "Delete", icon: <Trash2 className="size-3.5" />, onClick: () => handleDelete(s), danger: true },
                    ]}
                  />
                ) : undefined
              }
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{s.name}</span>
                <StatusBadge status={s.status} />
              </div>
              <div className="truncate text-xs text-text-muted">
                {s.primaryContactName ?? "No contact"}
                {s.primaryContactEmail ? ` · ${s.primaryContactEmail}` : ""}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                {s.paymentTerms ?? "No terms"} · {s.leadTimeDays === null ? "lead time not set" : `${s.leadTimeDays} d lead`} · {s.itemCount} item
                {s.itemCount === 1 ? "" : "s"}
              </div>
            </CardListItem>
          ))}
        </CardList>
        <Table stickyFirst className="hidden md:block">
          <THead>
            <TR>
              <TH className="text-start">Supplier</TH>
              <TH className="text-start">Status</TH>
              <TH className="text-start">Contact</TH>
              <TH className="text-start">Terms</TH>
              <TH className="text-end">Lead time</TH>
              <TH className="text-end">Items</TH>
              {isAdmin && <TH className="w-32"></TH>}
            </TR>
          </THead>
          <TBody>
            {suppliers.map((s) => (
              <TR key={s.id}>
                <TD>
                  <Link href={`/inventory/suppliers/${s.id}`} className="font-semibold text-text-primary hover:text-accent-text dark:text-zinc-100">
                    {s.name}
                  </Link>
                  {s.minimumOrderAmount && s.currency && (
                    <div className="text-xs text-text-muted">Min. {formatMoney(s.minimumOrderAmount, s.currency)}</div>
                  )}
                </TD>
                <TD>
                  <StatusBadge status={s.status} />
                </TD>
                <TD>
                  {s.primaryContactName ?? <span className="text-text-muted">None</span>}
                  {s.primaryContactEmail && <div className="text-xs text-text-muted">{s.primaryContactEmail}</div>}
                </TD>
                <TD>{s.paymentTerms ?? <span className="text-text-muted">Not set</span>}</TD>
                <TD className="text-end">{s.leadTimeDays === null ? "Not set" : `${s.leadTimeDays} d`}</TD>
                <TD className="text-end">{s.itemCount}</TD>
                {isAdmin && (
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Tooltip label={`Edit ${s.name}`}>
                        <button onClick={() => setEditing(s)} className={ICON_BTN} aria-label={`Edit ${s.name}`}>
                          <Pencil className="size-4" />
                        </button>
                      </Tooltip>
                      {s.status === "active" ? (
                        <Tooltip label={`Archive ${s.name}`}>
                          <button onClick={() => setStatus(s, "archived")} className={ICON_BTN} aria-label={`Archive ${s.name}`}>
                            <Archive className="size-4" />
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip label={`Restore ${s.name}`}>
                          <button onClick={() => setStatus(s, "active")} className={ICON_BTN} aria-label={`Restore ${s.name}`}>
                            <ArchiveRestore className="size-4" />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label={`Delete ${s.name}. A supplier used on a purchase order is archived instead.`} align="end">
                        <button onClick={() => handleDelete(s)} className={DANGER_BTN} aria-label={`Delete ${s.name}`}>
                          <Trash2 className="size-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        </>
      )}

      {(creating || editing) && (
        <SupplierFormModal
          supplier={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
