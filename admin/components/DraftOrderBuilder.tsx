"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createDraftOrder,
  listOutlets,
  listProducts,
  updateDraftOrder,
  validateDiscount,
} from "@/lib/api";
import type { DraftOrder, DraftOrderItemInput, Outlet, Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PageShell from "@/components/ui/PageShell";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import Combobox from "@/components/ui/Combobox";

// Mirrors backend/src/orders/constants.ts EMIRATES by hand — no shared
// package between admin/backend, same tradeoff as every other mirrored
// constant in this codebase (e.g. admin's PAYMENT_GATEWAY_PROVIDERS).
const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"] as const;

interface WorkingItem {
  productId: number;
  variantId?: number;
  productName: string;
  quantity: number;
  price: string;
}

// Shared by /draft-orders/new and /draft-orders/[id] (edit) — same "product
// prop optional = create vs edit" pattern as ProductForm. Product/outlet/
// emirate/order-type pickers are Combobox.tsx, same as every other picker
// in this app.
export default function DraftOrderBuilder({ draft }: { draft?: DraftOrder }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!draft;

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [outletId, setOutletId] = useState(draft?.outletId ?? 0);
  const [customerName, setCustomerName] = useState(draft?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(draft?.customerPhone ?? "");
  const [customerEmail, setCustomerEmail] = useState(draft?.customerEmail ?? "");
  const [customerAddress, setCustomerAddress] = useState(draft?.customerAddress ?? "");
  const [emirate, setEmirate] = useState(draft?.emirate ?? "Dubai");
  const [area, setArea] = useState(draft?.area ?? "");
  const [orderType, setOrderType] = useState(draft?.orderType ?? "delivery");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [items, setItems] = useState<WorkingItem[]>(
    draft?.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId ?? undefined,
      productName: i.variantLabel ? `${i.productName} — ${i.variantLabel}` : i.productName,
      quantity: i.quantity,
      price: i.price,
    })) ?? [],
  );
  const [discountCode, setDiscountCode] = useState(draft?.discount?.code ?? "");
  const [discountPreview, setDiscountPreview] = useState<{ valid: boolean; message?: string; discountAmount?: number } | null>(
    null,
  );

  const [addProductId, setAddProductId] = useState("");
  const [addVariantId, setAddVariantId] = useState("");
  const [addQuantity, setAddQuantity] = useState("1");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listOutlets().then((list) => {
      setOutlets(list);
      if (!draft && list[0]) setOutletId(list[0].id);
    });
    listProducts().then(setProducts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = useMemo(() => items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0), [items]);

  useEffect(() => {
    if (!discountCode.trim()) {
      setDiscountPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await validateDiscount({
          code: discountCode.trim(),
          cartSubtotal: subtotal,
          productIds: items.map((i) => i.productId),
        });
        setDiscountPreview(result);
      } catch {
        setDiscountPreview({ valid: false, message: "Could not check this code" });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [discountCode, subtotal, items]);

  const selectedAddProduct = products.find((p) => p.id === Number(addProductId));
  const discountAmount = discountPreview?.valid ? Number(discountPreview.discountAmount ?? 0) : 0;
  const total = Math.max(0, subtotal - discountAmount);

  function handleAddItem() {
    const product = selectedAddProduct;
    if (!product) return;
    const quantity = Math.max(1, Number(addQuantity) || 1);
    if (product.hasVariants) {
      const variant = product.variants.find((v) => v.id === Number(addVariantId));
      if (!variant) {
        toast("Select an option for this product", "error");
        return;
      }
      setItems((prev) => [
        ...prev,
        {
          productId: product.id,
          variantId: variant.id,
          productName: `${product.name} — ${variant.label}`,
          quantity,
          price: variant.price ?? product.price,
        },
      ]);
    } else {
      setItems((prev) => [
        ...prev,
        { productId: product.id, productName: product.name, quantity, price: product.price },
      ]);
    }
    setAddProductId("");
    setAddVariantId("");
    setAddQuantity("1");
  }

  function updateItem(index: number, patch: Partial<WorkingItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerName.trim() || !customerPhone.trim() || !customerAddress.trim()) {
      toast("Customer name, phone, and address are required", "error");
      return;
    }
    if (items.length === 0) {
      toast("Add at least one item", "error");
      return;
    }
    setSaving(true);
    try {
      const itemsPayload: DraftOrderItemInput[] = items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        price: Number(i.price),
      }));
      const payload = {
        outletId,
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        customerAddress,
        emirate,
        area: area || undefined,
        orderType,
        discountCode: discountCode.trim() || null,
        notes: notes || undefined,
        items: itemsPayload,
      };
      if (isEdit) {
        await updateDraftOrder(draft.id, payload);
        toast("Draft order saved");
        router.push(`/draft-orders/${draft.id}`);
      } else {
        const created = await createDraftOrder(payload);
        toast("Draft order created");
        router.push(`/draft-orders/${created.id}`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save draft order", "error");
    } finally {
      setSaving(false);
    }
  }

  const summary = (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">Order summary</h3>
      <div>
        <p className="text-xs text-zinc-500">Customer</p>
        <p className="text-sm font-medium truncate">{customerName.trim() || "No customer yet"}</p>
        {customerPhone.trim() && <p className="text-xs text-zinc-500">{customerPhone}</p>}
      </div>

      <div className="border-t border-black/5 dark:border-white/10 pt-3">
        {items.length === 0 ? (
          <p className="text-xs text-zinc-400">No items added yet</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, index) => (
              <li key={index} className="flex justify-between gap-2 text-sm">
                <span className="text-zinc-600 dark:text-zinc-300 truncate">
                  {item.quantity} × {item.productName}
                </span>
                <span className="shrink-0">{(Number(item.price) * item.quantity).toFixed(2)} AED</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-black/5 dark:border-white/10 pt-3 space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Subtotal</span>
          <span>{subtotal.toFixed(2)} AED</span>
        </div>
        {discountAmount > 0 && (
          <div className="flex items-center justify-between text-sm text-green-600 dark:text-green-400">
            <span>Discount</span>
            <span>-{discountAmount.toFixed(2)} AED</span>
          </div>
        )}
        <div className="flex items-center justify-between text-sm font-medium pt-1">
          <span>Total</span>
          <span>{total.toFixed(2)} AED</span>
        </div>
      </div>
    </Card>
  );

  return (
    <PageShell as="form" onSubmit={handleSubmit} variant="split" aside={summary}>
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Customer</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          <Input label="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Email (optional)"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
          <Input label="Address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} required />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Emirate"
            value={emirate}
            onChange={setEmirate}
            options={EMIRATES.map((em) => ({ value: em, label: em }))}
          />
          <Input label="Area (optional)" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Fulfillment</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Branch"
            value={String(outletId)}
            onChange={(v) => setOutletId(Number(v))}
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />
          <Combobox
            label="Order type"
            value={orderType}
            onChange={setOrderType}
            options={[
              { value: "delivery", label: "Delivery" },
              { value: "pickup", label: "Pickup" },
            ]}
          />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Items</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-40">
            <Combobox
              label="Product"
              value={addProductId}
              onChange={(v) => {
                setAddProductId(v);
                setAddVariantId("");
              }}
              placeholder="Select a product…"
              options={products.map((p) => ({ value: String(p.id), label: p.name }))}
            />
          </div>
          {selectedAddProduct?.hasVariants && (
            <div className="flex-1 min-w-32">
              <Combobox
                label="Option"
                value={addVariantId}
                onChange={setAddVariantId}
                placeholder="Select…"
                options={selectedAddProduct.variants.map((v) => ({ value: String(v.id), label: v.label ?? "" }))}
              />
            </div>
          )}
          <div className="w-20">
            <Input
              label="Qty"
              type="number"
              min="1"
              value={addQuantity}
              onChange={(e) => setAddQuantity(e.target.value)}
            />
          </div>
          <Button type="button" variant="secondary" onClick={handleAddItem} disabled={!addProductId}>
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            Add
          </Button>
        </div>

        {items.length > 0 && (
          <Table>
            <THead>
              <tr>
                <TH>Product</TH>
                <TH className="w-24">Qty</TH>
                <TH className="w-28">Price</TH>
                <TH className="w-10"></TH>
              </tr>
            </THead>
            <TBody>
              {items.map((item, index) => (
                <TR key={index}>
                  <TD>{item.productName}</TD>
                  <TD>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-16 border rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                    />
                  </TD>
                  <TD>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.price}
                      onChange={(e) => updateItem(index, { price: e.target.value })}
                      className="w-20 border rounded px-2 py-1 text-sm dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
                    />
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      aria-label="Remove item"
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Discount</h3>
        <Input
          label="Discount code (optional)"
          value={discountCode}
          onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
        />
        {discountPreview && (
          <p className={`text-xs ${discountPreview.valid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {discountPreview.valid
              ? `Applies: -${discountPreview.discountAmount} AED`
              : discountPreview.message ?? "This code cannot be applied"}
          </p>
        )}
      </Card>

      <Card>
        <Textarea label="Internal notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/draft-orders")}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {isEdit ? "Save changes" : "Create draft order"}
        </Button>
      </div>
    </PageShell>
  );
}
