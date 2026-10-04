"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  deleteMetafieldDefinition,
  listMetafieldDefinitions,
} from "@/lib/api";
import {
  METAFIELD_OWNER_LABELS,
  METAFIELD_OWNER_TYPES,
  METAFIELD_TYPE_LABELS,
  type MetafieldDefinition,
  type MetafieldOwnerType,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import Modal from "@/components/ui/Modal";
import PageShell from "@/components/ui/PageShell";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import MetafieldDefinitionFormModal from "@/components/MetafieldDefinitionFormModal";

export default function CustomFieldsPage() {
  const [defs, setDefs] = useState<MetafieldDefinition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MetafieldDefinition | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MetafieldDefinition | null>(null);
  // Set when the first delete attempt answered 409 (values exist); carries the
  // server's own explanation of how many values would go.
  const [valuesWarning, setValuesWarning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setDefs(await listMetafieldDefinitions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load custom fields");
    }
  }, []);

  // Initial load. Written with .then callbacks (not a call to refresh()) so
  // nothing sets state synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    listMetafieldDefinitions()
      .then((list) => {
        if (!cancelled) setDefs(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load custom fields");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function closeDelete() {
    setConfirmDelete(null);
    setValuesWarning(null);
  }

  // First try is a plain delete. If the field still holds values the API says so
  // (409) and nothing is removed; the merchant must then confirm deleting the
  // values with it, so a field is never dropped with data silently going too.
  async function handleDelete(def: MetafieldDefinition, withValues: boolean) {
    setDeleting(true);
    try {
      const result = await deleteMetafieldDefinition(def.id, withValues);
      toast(
        result.valuesDeleted > 0
          ? `"${def.name}" and ${result.valuesDeleted} saved value(s) deleted`
          : `"${def.name}" deleted`,
      );
      closeDelete();
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !withValues) {
        setValuesWarning(
          "This field has saved values on some records. Deleting it also deletes those values. This cannot be undone.",
        );
      } else {
        toast(err instanceof Error ? err.message : "Failed to delete custom field", "error");
      }
    } finally {
      setDeleting(false);
    }
  }

  const byOwner = (t: MetafieldOwnerType) => (defs ?? []).filter((d) => d.ownerType === t);

  return (
    <PageShell variant="wide">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Custom fields</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4 inline -mt-0.5 me-1" />
          Add custom field
        </Button>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Add your own fields to products, variants and collections. They appear
        in each editor. Customer, order and outlet fields are available through
        the API only. A field can be included in the public product data, which
        a storefront can read as <span className="font-mono">namespace.key</span>.
      </p>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <Card>
        {defs === null ? (
          error ? (
            <LoadFailed what="custom fields" onRetry={refresh} />
          ) : (
            <TableSkeleton rows={3} cols={5} />
          )
        ) : defs.length === 0 ? (
          <EmptyState
            title="No custom fields yet"
            description="Add a field to start capturing extra details on your products."
          />
        ) : (
          <div className="space-y-6">
            {METAFIELD_OWNER_TYPES.filter((t) => byOwner(t).length > 0).map((t) => (
              <div key={t}>
                <h2 className="text-sm font-semibold mb-2">{METAFIELD_OWNER_LABELS[t]}</h2>
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Handle</TH>
                      <TH>Type</TH>
                      <TH className="w-28">Public</TH>
                      <TH className="w-24 text-end">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {byOwner(t).map((d) => (
                      <TR key={d.id}>
                        <TD className="font-medium">{d.name}</TD>
                        <TD className="font-mono text-[13px]">
                          {d.namespace}.{d.key}
                        </TD>
                        <TD>{METAFIELD_TYPE_LABELS[d.type] ?? d.type}</TD>
                        <TD>{d.visibleOnStorefront ? "Yes" : "No"}</TD>
                        <TD>
                          <div className="flex justify-end gap-1">
                            <Tooltip label={`Edit ${d.name}`}>
                              <button
                                onClick={() => setEditing(d)}
                                aria-label={`Edit ${d.name}`}
                                className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                              >
                                <Pencil className="size-4" />
                              </button>
                            </Tooltip>
                            <Tooltip label={`Delete ${d.name}`} align="end">
                              <button
                                onClick={() => setConfirmDelete(d)}
                                aria-label={`Delete ${d.name}`}
                                className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
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
              </div>
            ))}
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <MetafieldDefinitionFormModal
          definition={editing}
          defaultOwnerType="product"
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}

      {confirmDelete && (
        <Modal
          onClose={closeDelete}
          size="sm"
          title={`Delete "${confirmDelete.name}"?`}
        >
          {(requestClose) => (
            <div>
              <p className="text-sm text-text-secondary dark:text-zinc-400">
                {valuesWarning ??
                  "This removes the field from every editor. No product, variant or collection is deleted."}
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
                  onClick={() => void handleDelete(confirmDelete, valuesWarning !== null)}
                >
                  {valuesWarning ? "Delete field and values" : "Delete"}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </PageShell>
  );
}
