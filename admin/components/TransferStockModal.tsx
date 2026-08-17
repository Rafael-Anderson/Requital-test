"use client";

import { useEffect, useState } from "react";
import { listOutlets, transferStock } from "@/lib/api";
import type { Ingredient, Outlet, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

// Discriminated so the same modal serves both Products (which may have
// variants) and Ingredients (which never do) without either branch leaking
// into the other's shape.
export type TransferTarget =
  | { kind: "product"; product: Product }
  | { kind: "ingredient"; ingredient: Ingredient };

// Not portaled — unlike VariantEditModal, this is never mounted inside a
// page-level <form> (the Inventory list page is a plain page), so the
// nested-form issue that required a portal there doesn't apply here.
export default function TransferStockModal({
  target,
  onClose,
  onTransferred,
}: {
  target: TransferTarget;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const toast = useToast();
  const name = target.kind === "product" ? target.product.name : target.ingredient.name;
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [variantId, setVariantId] = useState("");
  const [fromOutletId, setFromOutletId] = useState("");
  const [toOutletId, setToOutletId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listOutlets().then((list) => {
      setOutlets(list);
      if (list[0]) setFromOutletId(String(list[0].id));
      if (list[1]) setToOutletId(String(list[1].id));
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fromOutletId || !toOutletId || fromOutletId === toOutletId) {
      toast("Pick two different branches", "error");
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      toast("Quantity must be a positive number", "error");
      return;
    }
    setSaving(true);
    try {
      await transferStock({
        ...(target.kind === "product"
          ? { productId: target.product.id, variantId: variantId ? Number(variantId) : undefined }
          : { ingredientId: target.ingredient.id }),
        fromOutletId: Number(fromOutletId),
        toOutletId: Number(toOutletId),
        quantity: qty,
        note: note || undefined,
      });
      toast(`Transferred ${qty} unit${qty === 1 ? "" : "s"} of "${name}"`);
      onTransferred();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to transfer stock", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="sm" title="Transfer stock">
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-text-muted -mt-2 mb-4">{name}</p>

        <div className="space-y-3.5">
          {target.kind === "product" && target.product.hasVariants && (
            <Select
              label="Variant"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              required
            >
              <option value="">Select a variant…</option>
              {target.product.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}

          <Combobox
            label="From branch"
            value={fromOutletId}
            onChange={setFromOutletId}
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />

          <Combobox
            label="To branch"
            value={toOutletId}
            onChange={setToOutletId}
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />

          <Input
            label="Quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />

          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {saving ? "Transferring…" : "Transfer"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
