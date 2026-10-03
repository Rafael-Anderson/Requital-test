"use client";

import { useEffect, useState, type FormEvent } from "react";
import { listIngredients, saveSupplierItem } from "@/lib/api";
import { SUPPLIER_CURRENCIES, type Ingredient, type SupplierDetail, type SupplierItem } from "@/lib/types";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// One row of the supplier's catalogue: which ingredient they sell, their own
// SKU, and what they charge. Currency left on "supplier currency" is omitted
// from the request, so the server inherits the supplier's stated currency
// (and refuses a cost when there is none anywhere).
export default function SupplierItemFormModal({
  supplier,
  item,
  onClose,
  onSaved,
}: {
  supplier: SupplierDetail;
  item: SupplierItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState(item ? String(item.ingredientId) : "");
  const [sku, setSku] = useState(item?.supplierSku ?? "");
  const [unitCost, setUnitCost] = useState(item?.unitCost ?? "");
  const [currency, setCurrency] = useState(item?.currency ?? "");
  const [minQty, setMinQty] = useState(item?.minOrderQty?.toString() ?? "");
  const [leadTime, setLeadTime] = useState(item?.leadTimeDays?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) return;
    listIngredients()
      .then((all) => setIngredients(all))
      .catch(() => toast("Failed to load ingredients", "error"));
  }, [item, toast]);

  const taken = new Set(supplier.items.map((i) => i.ingredientId));
  const options = ingredients
    .filter((i) => !taken.has(i.id))
    .map((i) => ({ value: String(i.id), label: `${i.name} (${i.unit})` }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ingredientId) return;
    if (unitCost.trim() !== "" && !currency && !supplier.currency) {
      toast("Choose a currency for the cost, or set one on the supplier.", "error");
      return;
    }
    setSaving(true);
    try {
      await saveSupplierItem(supplier.id, Number(ingredientId), {
        supplierSku: sku.trim() || null,
        unitCost: unitCost.trim() === "" ? null : Number(unitCost),
        ...(currency ? { currency } : {}),
        minOrderQty: minQty.trim() === "" ? null : Number(minQty),
        leadTimeDays: leadTime.trim() === "" ? null : Number(leadTime),
      });
      toast("Item saved");
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save item", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={item ? `Edit ${item.ingredientName}` : "Add a supplied item"}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!item && (
              <div className="sm:col-span-2">
                <Combobox
                  label="Ingredient"
                  value={ingredientId}
                  onChange={setIngredientId}
                  options={options}
                  placeholder="Choose an ingredient"
                  searchPlaceholder="Search ingredients"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <Input label="Supplier SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <Input
              label="Unit cost"
              type="number"
              min={0}
              step="any"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
            <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">{supplier.currency ? `Supplier currency (${supplier.currency})` : "Not set"}</option>
              {SUPPLIER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input
              label="Minimum order quantity"
              type="number"
              min={1}
              step={1}
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
            <Input
              label="Lead time (days)"
              type="number"
              min={0}
              step={1}
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !ingredientId} loading={saving}>
              {saving ? "Saving…" : "Save item"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
