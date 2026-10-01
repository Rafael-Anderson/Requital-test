"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteTaxClass, listTaxClasses } from "@/lib/api";
import { TAX_CLASS_TYPE_LABELS, type TaxClass } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import PageShell from "@/components/ui/PageShell";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import TaxClassFormModal from "@/components/TaxClassFormModal";

export default function TaxClassesPage() {
  const [classes, setClasses] = useState<TaxClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaxClass | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TaxClass | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setClasses(await listTaxClasses());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load tax classes",
      );
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // No undo here, unlike the Brands page: deleting a class unassigns every
  // product that used it, and an optimistic-remove-then-restore cannot put those
  // assignments back. A confirm that states the consequence is the honest shape.
  async function handleDelete(taxClass: TaxClass) {
    setDeleting(true);
    try {
      const result = await deleteTaxClass(taxClass.id);
      toast(
        result.productsUnassigned > 0
          ? `"${taxClass.name}" deleted. ${result.productsUnassigned} product(s) now use the default class.`
          : `"${taxClass.name}" deleted`,
      );
      setConfirmDelete(null);
      await refresh();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to delete tax class",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageShell variant="wide">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tax Classes</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4 inline -mt-0.5 me-1" />
          Add Tax Class
        </Button>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Set a VAT treatment per product instead of one rate for your whole
        catalog. Zero rated and exempt are both 0%, but they are reported
        differently on a return, so keep them as separate classes.
      </p>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <Card>
        {classes === null ? (
          <TableSkeleton rows={3} cols={4} />
        ) : classes.length === 0 ? (
          <EmptyState
            title="No tax classes yet"
            description="Add a class to start assigning VAT treatments to your products."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Treatment</TH>
                <TH className="w-24">Rate</TH>
                <TH className="w-24 text-end">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {classes.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">
                    {c.name}
                    {c.isDefault && (
                      <span className="ms-2 rounded px-1.5 py-0.5 text-[11px] font-semibold bg-accent-tint text-accent-text">
                        Default
                      </span>
                    )}
                  </TD>
                  <TD>{TAX_CLASS_TYPE_LABELS[c.type] ?? c.type}</TD>
                  <TD>{Number(c.rate)}%</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Tooltip label={`Edit ${c.name}`}>
                        <button
                          onClick={() => setEditing(c)}
                          aria-label={`Edit ${c.name}`}
                          className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </Tooltip>
                      <Tooltip
                        label={
                          c.isDefault
                            ? "The default class cannot be deleted"
                            : `Delete ${c.name}`
                        }
                        align="end"
                      >
                        <button
                          onClick={() => setConfirmDelete(c)}
                          disabled={c.isDefault}
                          aria-label={`Delete ${c.name}`}
                          className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:bg-transparent"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {(creating || editing) && (
        <TaxClassFormModal
          taxClass={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}

      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(null)}
          size="sm"
          title={`Delete "${confirmDelete.name}"?`}
        >
          {(requestClose) => (
            <div>
              <p className="text-sm text-text-secondary dark:text-zinc-400">
                Any product using this class will fall back to your default
                class. No product is deleted.
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <Button type="button" variant="secondary" onClick={requestClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={deleting}
                  loading={deleting}
                  onClick={() => void handleDelete(confirmDelete)}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </PageShell>
  );
}
