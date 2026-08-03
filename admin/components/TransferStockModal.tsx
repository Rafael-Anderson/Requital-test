"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { listOutlets, transferStock } from "@/lib/api";
import type { Ingredient, Outlet, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">Transfer stock</h2>
        <p className="text-sm text-zinc-500 mb-4">{name}</p>

        <div className="space-y-3.5">
          {target.kind === "product" && target.product.hasVariants && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Variant</label>
              <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className={SELECT_CLASS} required>
                <option value="">Select a variant…</option>
                {target.product.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">From branch</label>
            <select value={fromOutletId} onChange={(e) => setFromOutletId(e.target.value)} className={SELECT_CLASS}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">To branch</label>
            <select value={toOutletId} onChange={(e) => setToOutletId(e.target.value)} className={SELECT_CLASS}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />

          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Transferring…" : "Transfer"}
          </Button>
        </div>
      </form>
    </div>
  );
}
