"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { listProducts, updateOrderItems } from "@/lib/api";
import type { Order, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

interface WorkingItem {
  productId: number;
  variantId?: number;
  productName: string;
  quantity: number;
}

const lineKey = (productId: number, variantId?: number | null) => `${productId}:${variantId ?? ""}`;

export default function EditOrderItemsModal({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
  onClose: () => void;
  onSaved: (updated: Order) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<WorkingItem[]>(
    order.orderitem.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? undefined,
      productName: i.variantLabel ? `${i.productName} · ${i.variantLabel}` : i.productName,
      quantity: i.quantity,
    })),
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addVariantId, setAddVariantId] = useState("");
  const [addQuantity, setAddQuantity] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  const selectedAddProduct = products.find((p) => p.id === Number(addProductId));

  function updateQuantity(productId: number, variantId: number | undefined, quantity: number) {
    setItems((prev) =>
      prev.map((i) =>
        lineKey(i.productId, i.variantId) === lineKey(productId, variantId)
          ? { ...i, quantity: Math.max(1, quantity) }
          : i,
      ),
    );
  }

  function removeItem(productId: number, variantId: number | undefined) {
    setItems((prev) => prev.filter((i) => lineKey(i.productId, i.variantId) !== lineKey(productId, variantId)));
  }

  function handleAdd() {
    const product = selectedAddProduct;
    if (!product) return;
    const quantity = Math.max(1, Number(addQuantity) || 1);

    if (product.hasVariants) {
      const variant = product.variants.find((v) => v.id === Number(addVariantId));
      if (!variant) {
        toast("Select an option for this product", "error");
        return;
      }
      if (items.some((i) => lineKey(i.productId, i.variantId) === lineKey(product.id, variant.id))) {
        toast("That option is already on this order. Adjust its quantity instead.", "error");
        return;
      }
      setItems((prev) => [
        ...prev,
        { productId: product.id, variantId: variant.id, productName: `${product.name} · ${variant.label}`, quantity },
      ]);
    } else {
      if (items.some((i) => lineKey(i.productId, i.variantId) === lineKey(product.id, undefined))) {
        toast("That product is already on this order. Adjust its quantity instead.", "error");
        return;
      }
      setItems((prev) => [...prev, { productId: product.id, productName: product.name, quantity }]);
    }
    setAddProductId("");
    setAddVariantId("");
    setAddQuantity("1");
  }

  async function handleSave() {
    if (items.length === 0) {
      toast("An order must have at least one item", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateOrderItems(
        order.id,
        items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity })),
      );
      if (updated.discountDropped) {
        toast("Saved. The applied discount no longer qualified and was removed.", "error");
      }
      if (updated.ingredientStockWarnings.length > 0) {
        toast(`Saved. ${updated.ingredientStockWarnings.join(", ")} stock is now below zero at this outlet`, "error");
      }
      if (!updated.discountDropped && updated.ingredientStockWarnings.length === 0) {
        toast("Order items updated");
      }
      onSaved(updated);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update order items", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="md"
      title="Edit items"
      footer={(requestClose) => (
        <>
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} disabled={saving} loading={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </>
      )}
    >
        <p className="text-sm text-zinc-500 -mt-2 mb-4">Order #{order.id}</p>

        <Table>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH className="w-20">Qty</TH>
              <TH className="w-10"></TH>
            </tr>
          </THead>
          <TBody>
            {items.map((item) => (
              <TR key={lineKey(item.productId, item.variantId)}>
                <TD>{item.productName}</TD>
                <TD>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.productId, item.variantId, Number(e.target.value) || 1)}
                    className="w-16 border border-black/15 dark:border-white/15 rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                  />
                </TD>
                <TD>
                  <button
                    type="button"
                    onClick={() => removeItem(item.productId, item.variantId)}
                    aria-label={`Remove ${item.productName}`}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        <div className="flex flex-wrap items-end gap-2 mt-4">
          <div className="flex-1 min-w-40">
            <Combobox
              label="Add product"
              value={addProductId}
              onChange={(value) => {
                setAddProductId(value);
                setAddVariantId("");
              }}
              options={products.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          </div>
          {selectedAddProduct?.hasVariants && (
            <div className="flex-1 min-w-32">
              <Select label="Option" value={addVariantId} onChange={(e) => setAddVariantId(e.target.value)}>
                <option value="">Select…</option>
                {selectedAddProduct.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="w-20">
            <label className="text-sm font-medium block mb-1">Qty</label>
            <input
              type="number"
              min="1"
              value={addQuantity}
              onChange={(e) => setAddQuantity(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm outline-none focus:border-accent transition-shadow focus:ring-[3px] focus:ring-accent/20"
            />
          </div>
          <Button type="button" variant="secondary" onClick={handleAdd} disabled={!addProductId}>
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            Add
          </Button>
        </div>
    </Modal>
  );
}
