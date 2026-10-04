"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteSupplierContact, deleteSupplierItem, getSupplier } from "@/lib/api";
import type { SupplierContact, SupplierDetail, SupplierItem } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/money";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import LoadFailed from "@/components/ui/LoadFailed";
import ScrollFade from "@/components/ui/ScrollFade";
import { CardList, CardListItem, CardRowMenu } from "@/components/ui/CardList";
import InventoryTabs from "@/components/InventoryTabs";
import StatusBadge from "@/components/StatusBadge";
import SupplierFormModal from "@/components/SupplierFormModal";
import SupplierContactFormModal from "@/components/SupplierContactFormModal";
import SupplierItemFormModal from "@/components/SupplierItemFormModal";

const ICON_BTN =
  "p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer";
const DANGER_BTN =
  "p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer";

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "admin";
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState(false);
  const [contactModal, setContactModal] = useState<SupplierContact | "new" | null>(null);
  const [itemModal, setItemModal] = useState<SupplierItem | "new" | null>(null);

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let live = true;
    getSupplier(id)
      .then((row) => {
        if (!live) return;
        setSupplier(row);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load supplier");
      });
    return () => {
      live = false;
    };
  }, [id, version]);

  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      await action();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : failure, "error");
    }
  }

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory/suppliers" />
      <InventoryTabs />
      {error && supplier && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}
      {error && !supplier && <LoadFailed what="the supplier" onRetry={refresh} />}
      {supplier && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">{supplier.name}</h1>
                <div className="mt-1">
                  <StatusBadge status={supplier.status} />
                </div>
              </div>
              {isAdmin && (
                <Tooltip label="Edit supplier">
                  <button onClick={() => setEditingSupplier(true)} className={ICON_BTN} aria-label="Edit supplier">
                    <Pencil className="size-4" />
                  </button>
                </Tooltip>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Field label="Payment terms" value={supplier.paymentTerms} />
              <Field label="Lead time" value={supplier.leadTimeDays === null ? null : `${supplier.leadTimeDays} days`} />
              <Field label="Currency" value={supplier.currency} />
              <Field
                label="Minimum order"
                value={supplier.minimumOrderAmount && supplier.currency ? formatMoney(supplier.minimumOrderAmount, supplier.currency) : null}
              />
              <div className="sm:col-span-2">
                <Field label="Notes" value={supplier.notes} />
              </div>
            </dl>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary dark:text-zinc-50">Contacts</h2>
              {isAdmin && (
                <Button variant="secondary" onClick={() => setContactModal("new")}>
                  <Plus className="-mt-0.5 me-1 inline size-4" />
                  Add
                </Button>
              )}
            </div>
            {supplier.contacts.length === 0 ? (
              <p className="text-sm text-text-muted">No contacts yet.</p>
            ) : (
              <ul className="divide-y divide-border-light dark:divide-white/10">
                {supplier.contacts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="min-w-0 text-sm">
                      <div className="font-semibold text-text-primary dark:text-zinc-100">
                        {c.name}
                        {c.isPrimary && <span className="ms-2 text-xs font-bold text-accent-text">Primary</span>}
                      </div>
                      {c.role && <div className="text-text-muted">{c.role}</div>}
                      {c.email && <div className="truncate">{c.email}</div>}
                      {c.phone && <div>{c.phone}</div>}
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 gap-1">
                        <Tooltip label={`Edit ${c.name}`}>
                          <button onClick={() => setContactModal(c)} className={ICON_BTN} aria-label={`Edit ${c.name}`}>
                            <Pencil className="size-4" />
                          </button>
                        </Tooltip>
                        <Tooltip label={`Remove ${c.name}`} align="end">
                          <button
                            onClick={() => run(() => deleteSupplierContact(id, c.id), "Failed to remove contact")}
                            className={DANGER_BTN}
                            aria-label={`Remove ${c.name}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary dark:text-zinc-50">Supplied items</h2>
              {isAdmin && (
                <Button variant="secondary" onClick={() => setItemModal("new")}>
                  <Plus className="-mt-0.5 me-1 inline size-4" />
                  Add item
                </Button>
              )}
            </div>
            {supplier.items.length === 0 ? (
              <EmptyState
                title="No items yet"
                description="List the ingredients this supplier sells, with their SKU and price, so purchase orders can be filled in for you."
              />
            ) : (
              <>
              <CardList>
                {supplier.items.map((i) => (
                  <CardListItem
                    key={i.id}
                    onOpen={isAdmin ? () => setItemModal(i) : undefined}
                    openLabel={`Edit ${i.ingredientName}`}
                    actions={
                      isAdmin ? (
                        <CardRowMenu
                          label={`More actions for ${i.ingredientName}`}
                          items={[
                            { label: "Edit", icon: <Pencil className="size-3.5" />, onClick: () => setItemModal(i) },
                            {
                              label: "Remove",
                              icon: <Trash2 className="size-3.5" />,
                              onClick: () => run(() => deleteSupplierItem(id, i.ingredientId), "Failed to remove item"),
                              danger: true,
                            },
                          ]}
                        />
                      ) : undefined
                    }
                  >
                    <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">
                      {i.ingredientName} <span className="font-normal text-text-muted">({i.ingredientUnit})</span>
                    </div>
                    <div className="mt-0.5 text-[13.5px] font-bold text-text-primary dark:text-zinc-100">
                      {i.unitCost !== null && i.currency ? formatMoney(i.unitCost, i.currency) : <span className="font-normal text-text-muted">No price</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {i.supplierSku ?? "No SKU"} · min {i.minOrderQty ?? "not set"} · {i.leadTimeDays === null ? "lead time not set" : `${i.leadTimeDays} d lead`}
                    </div>
                  </CardListItem>
                ))}
              </CardList>
              <ScrollFade stickyFirst className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-[11.5px] font-bold uppercase tracking-wide text-text-faint">
                      <th className="p-2 text-start">Ingredient</th>
                      <th className="p-2 text-start">Supplier SKU</th>
                      <th className="p-2 text-end">Unit cost</th>
                      <th className="p-2 text-end">Min. qty</th>
                      <th className="p-2 text-end">Lead time</th>
                      {isAdmin && <th className="w-20 p-2"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {supplier.items.map((i) => (
                      <tr key={i.id} className="border-t border-border-light dark:border-white/10">
                        <td className="p-2 font-semibold">
                          {i.ingredientName} <span className="font-normal text-text-muted">({i.ingredientUnit})</span>
                        </td>
                        <td className="p-2">{i.supplierSku ?? <span className="text-text-muted">Not set</span>}</td>
                        <td className="p-2 text-end">
                          {i.unitCost !== null && i.currency ? formatMoney(i.unitCost, i.currency) : <span className="text-text-muted">Not set</span>}
                        </td>
                        <td className="p-2 text-end">{i.minOrderQty ?? "Not set"}</td>
                        <td className="p-2 text-end">{i.leadTimeDays === null ? "Not set" : `${i.leadTimeDays} d`}</td>
                        {isAdmin && (
                          <td className="p-2">
                            <div className="flex justify-end gap-1">
                              <Tooltip label={`Edit ${i.ingredientName}`}>
                                <button onClick={() => setItemModal(i)} className={ICON_BTN} aria-label={`Edit ${i.ingredientName}`}>
                                  <Pencil className="size-4" />
                                </button>
                              </Tooltip>
                              <Tooltip label={`Remove ${i.ingredientName}`} align="end">
                                <button
                                  onClick={() => run(() => deleteSupplierItem(id, i.ingredientId), "Failed to remove item")}
                                  className={DANGER_BTN}
                                  aria-label={`Remove ${i.ingredientName}`}
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </Tooltip>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollFade>
              </>
            )}
          </Card>
        </div>
      )}

      {supplier && editingSupplier && (
        <SupplierFormModal supplier={supplier} onClose={() => setEditingSupplier(false)} onSaved={refresh} />
      )}
      {supplier && contactModal && (
        <SupplierContactFormModal
          supplierId={id}
          contact={contactModal === "new" ? null : contactModal}
          onClose={() => setContactModal(null)}
          onSaved={refresh}
        />
      )}
      {supplier && itemModal && (
        <SupplierItemFormModal
          supplier={supplier}
          item={itemModal === "new" ? null : itemModal}
          onClose={() => setItemModal(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-text-primary dark:text-zinc-100">{value ?? <span className="text-text-muted">Not set</span>}</dd>
    </div>
  );
}
