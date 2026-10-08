"use client";

import { useEffect, useState, type FormEvent } from "react";
import { listIngredients, setReorderPoint } from "@/lib/api";
import type { Ingredient, Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

export interface ReorderPointTarget {
  ingredientId: number;
  name: string;
  outletId: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
}

// Whole non-negative number, or null when blank. Blank means "unknown" and is sent as
// null: an empty field is never turned into 0.
function parseCount(value: string, min: number): number | null | "invalid" {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "invalid";
  const n = Number(v);
  return n >= min ? n : "invalid";
}

// Sets or clears one (outlet, ingredient) reorder point. Opened from a row (target
// given) or empty to pick an item and outlet.
export default function ReorderPointModal({
  target,
  outlets,
  defaultOutletId,
  onClose,
  onSaved,
}: {
  target: ReorderPointTarget | null;
  outlets: Outlet[];
  defaultOutletId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [ingredientId, setIngredientId] = useState(target ? String(target.ingredientId) : "");
  const [outletId, setOutletId] = useState(String(target?.outletId ?? defaultOutletId ?? outlets[0]?.id ?? ""));
  const [point, setPoint] = useState(target?.reorderPoint != null ? String(target.reorderPoint) : "");
  const [qty, setQty] = useState(target?.reorderQuantity != null ? String(target.reorderQuantity) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) return;
    let live = true;
    listIngredients()
      .then((rows) => live && setIngredients(rows))
      .catch((err) => live && setError(err instanceof Error ? err.message : "Failed to load items"));
    return () => {
      live = false;
    };
  }, [target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const p = parseCount(point, 0);
    const q = parseCount(qty, 1);
    if (p === "invalid") return setError("The reorder point must be a whole number, 0 or more. Leave it blank for none.");
    if (q === "invalid") return setError("The reorder quantity must be a whole number, 1 or more. Leave it blank for none.");
    if (!ingredientId || !outletId) return setError("Choose an item and a branch.");
    setSaving(true);
    setError(null);
    try {
      await setReorderPoint({ ingredientId: Number(ingredientId), outletId: Number(outletId), reorderPoint: p, reorderQuantity: q });
      toast(p === null && q === null ? "Reorder point cleared" : "Reorder point saved");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title={target ? `Reorder point: ${target.name}` : "Set a reorder point"}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            {!target && (
              <Select label="Item" value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} disabled={ingredients === null}>
                <option value="">{ingredients === null ? "Loading…" : "Choose an item"}</option>
                {(ingredients ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            )}
            {!target && (
              <Select label="Branch" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
            <Input label="Reorder when stock reaches" inputMode="numeric" value={point} onChange={(e) => setPoint(e.target.value)} placeholder="No reorder point" />
            <Input label="Order this many each time" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Not set" />
            <p className="text-xs text-text-muted">Leave both blank to stop suggesting this item. Stock already on open orders counts towards the point.</p>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
