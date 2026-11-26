"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Search } from "lucide-react";
import {
  createDraftOrder,
  getCustomer,
  getRegions,
  listCustomers,
  listOutlets,
  listProductsPage,
  previewDraftOrder,
  updateDraftOrder,
} from "@/lib/api";
import type {
  CustomerListItem,
  DraftBill,
  DraftOrder,
  DraftOrderInput,
  DraftOrderItemInput,
  Outlet,
  Product,
  RegionsResponse,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";
import Combobox from "@/components/ui/Combobox";
import SegmentedToggle from "@/components/ui/SegmentedToggle";
import Toggle from "@/components/ui/Toggle";
import Money from "@/components/Money";

// One builder line: a catalogue product (optionally with a changed price, which
// needs a reason) or a custom item (name + price, not tracked in inventory).
export interface WorkingItem {
  key: string;
  custom: boolean;
  productId?: number;
  variantId?: number;
  name: string;
  thumbnail?: string | null;
  quantity: number;
  // Catalogue: null = the live price; a string = staff changed it.
  // Custom: the item's price.
  price: string | null;
  priceReason: string;
  taxable: boolean;
}

let keySeq = 0;
const nextKey = () => `l${++keySeq}`;

// The request body the builder sends (save and preview use the same shape).
export function buildDraftPayload(form: {
  outletId: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  orderType: "delivery" | "pickup";
  customerAddress: string;
  regionId: number | null;
  area: string;
  deliveryDate: string;
  deliveryTimeSlot: string;
  receiverOn: boolean;
  receiverName: string;
  receiverPhone: string;
  receiverMessage: string;
  discountMode: "none" | "code" | "manual";
  discountCode: string;
  orderDiscountType: "percent" | "fixed";
  orderDiscountValue: string;
  orderDiscountReason: string;
  feeOverrideOn: boolean;
  feeOverride: string;
  feeOverrideReason: string;
  notes: string;
  customerNote: string;
  items: WorkingItem[];
}): DraftOrderInput {
  const delivery = form.orderType === "delivery";
  const items: DraftOrderItemInput[] = form.items.map((i) =>
    i.custom
      ? { customName: i.name.trim(), price: Number(i.price ?? 0), quantity: i.quantity, taxable: i.taxable }
      : {
          productId: i.productId,
          variantId: i.variantId,
          quantity: i.quantity,
          ...(i.price !== null ? { price: Number(i.price), priceReason: i.priceReason.trim() } : {}),
        },
  );
  return {
    outletId: form.outletId,
    customerName: form.customerName.trim() || undefined,
    customerPhone: form.customerPhone.trim() || undefined,
    customerEmail: form.customerEmail.trim() || undefined,
    orderType: form.orderType,
    customerAddress: delivery ? form.customerAddress.trim() || undefined : undefined,
    regionId: delivery ? (form.regionId ?? undefined) : undefined,
    area: delivery ? form.area.trim() || undefined : undefined,
    deliveryDate: form.deliveryDate || undefined,
    deliveryTimeSlot: form.deliveryTimeSlot.trim() || undefined,
    receiverName: form.receiverOn ? form.receiverName.trim() || undefined : undefined,
    receiverPhone: form.receiverOn ? form.receiverPhone.trim() || undefined : undefined,
    receiverMessage: form.receiverMessage.trim() || undefined,
    discountCode: form.discountMode === "code" ? form.discountCode.trim() || null : null,
    orderDiscountType: form.discountMode === "manual" ? form.orderDiscountType : null,
    ...(form.discountMode === "manual"
      ? { orderDiscountValue: Number(form.orderDiscountValue || 0), orderDiscountReason: form.orderDiscountReason.trim() }
      : {}),
    deliveryFeeOverride: delivery && form.feeOverrideOn ? Number(form.feeOverride || 0) : null,
    ...(delivery && form.feeOverrideOn ? { deliveryFeeOverrideReason: form.feeOverrideReason.trim() } : {}),
    notes: form.notes || undefined,
    customerNote: form.customerNote.trim() || undefined,
    items: items.length ? items : undefined,
  };
}

// Client-side checks that name the field; the server checks the same again.
export function draftFormProblems(form: Parameters<typeof buildDraftPayload>[0]): string[] {
  const problems: string[] = [];
  if (!form.customerName.trim()) problems.push("Add the customer's name");
  if (!form.customerPhone.trim()) problems.push("Add the customer's phone");
  form.items.forEach((i, n) => {
    if (i.custom && !i.name.trim()) problems.push(`Line ${n + 1}: give the custom item a name`);
    if (i.custom && (i.price === null || i.price === "")) problems.push(`Line ${n + 1}: give the custom item a price`);
    if (!i.custom && i.price !== null && !i.priceReason.trim())
      problems.push(`Line ${n + 1}: give a reason for the changed price`);
  });
  if (form.receiverOn && (!form.receiverName.trim() || !form.receiverPhone.trim()))
    problems.push("Add both the receiver's name and phone");
  if (form.discountMode === "manual" && !form.orderDiscountReason.trim()) problems.push("Give a reason for the discount");
  if (form.orderType === "delivery" && form.feeOverrideOn && !form.feeOverrideReason.trim())
    problems.push("Give a reason for the changed delivery fee");
  return problems;
}

// Shared by /orders/draft-orders/new and /orders/draft-orders/[id] (edit). Every
// total on screen comes from POST /shop/draft-orders/preview: the backend prices
// the cart with the same code as storefront checkout.
export default function DraftOrderBuilder({ draft, customerId }: { draft?: DraftOrder; customerId?: number }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!draft;

  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [regionsRes, setRegionsRes] = useState<RegionsResponse | null>(null);
  const [outletId, setOutletId] = useState(draft?.outletId ?? 0);

  const [customerName, setCustomerName] = useState(draft?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(draft?.customerPhone ?? "");
  const [customerEmail, setCustomerEmail] = useState(draft?.customerEmail ?? "");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerListItem[]>([]);

  const [orderType, setOrderType] = useState<"delivery" | "pickup">(draft?.orderType ?? "delivery");
  const [customerAddress, setCustomerAddress] = useState(draft?.customerAddress ?? "");
  // No default region: a silent "Dubai" is how an order ends up in the wrong zone.
  const [regionId, setRegionId] = useState<number | null>(draft?.regionId ?? null);
  const [area, setArea] = useState(draft?.area ?? "");
  const [deliveryDate, setDeliveryDate] = useState(draft?.deliveryDate ?? "");
  const [deliveryTimeSlot, setDeliveryTimeSlot] = useState(draft?.deliveryTimeSlot ?? "");
  const [feeOverrideOn, setFeeOverrideOn] = useState(draft?.deliveryFeeOverride != null);
  const [feeOverride, setFeeOverride] = useState(draft?.deliveryFeeOverride ?? "");
  const [feeOverrideReason, setFeeOverrideReason] = useState(draft?.deliveryFeeOverrideReason ?? "");

  const [receiverOn, setReceiverOn] = useState(!!draft?.receiverName);
  const [receiverName, setReceiverName] = useState(draft?.receiverName ?? "");
  const [receiverPhone, setReceiverPhone] = useState(draft?.receiverPhone ?? "");
  const [receiverMessage, setReceiverMessage] = useState(draft?.receiverMessage ?? "");

  const [discountMode, setDiscountMode] = useState<"none" | "code" | "manual">(
    draft?.orderDiscountType ? "manual" : draft?.discountCode ? "code" : "none",
  );
  const [discountCode, setDiscountCode] = useState(draft?.discountCode ?? "");
  const [orderDiscountType, setOrderDiscountType] = useState<"percent" | "fixed">(draft?.orderDiscountType ?? "percent");
  const [orderDiscountValue, setOrderDiscountValue] = useState(draft?.orderDiscountValue ?? "");
  const [orderDiscountReason, setOrderDiscountReason] = useState(draft?.orderDiscountReason ?? "");

  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [customerNote, setCustomerNote] = useState(draft?.customerNote ?? "");

  const [items, setItems] = useState<WorkingItem[]>(
    draft?.items.map((i) => ({
      key: nextKey(),
      custom: i.isCustom,
      productId: i.productId ?? undefined,
      variantId: i.variantId ?? undefined,
      name: i.isCustom ? i.productName : i.variantLabel ? `${i.productName} · ${i.variantLabel}` : i.productName,
      thumbnail: i.thumbnail,
      quantity: i.quantity,
      price: i.isCustom || i.priceOverrideReason ? i.price : null,
      priceReason: i.priceOverrideReason ?? "",
      taxable: i.taxable ?? true,
    })) ?? [],
  );

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<Product[]>([]);
  const [pickedVariant, setPickedVariant] = useState<Record<number, string>>({});

  const [bill, setBill] = useState<DraftBill | null>(draft?.bill ?? null);
  const [billError, setBillError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    listOutlets()
      .then((list) => {
        setOutlets(list);
        if (!draft && list[0]) setOutletId((cur) => cur || list[0].id);
      })
      .catch((err) => toast(err instanceof Error ? err.message : "Failed to load branches", "error"));
    getRegions()
      .then(setRegionsRes)
      .catch(() => setRegionsRes(null));
    if (customerId && !draft) {
      getCustomer(customerId)
        .then((c) => {
          setCustomerName(c.name);
          setCustomerPhone(c.phone);
          setCustomerEmail(c.email ?? "");
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Customer search (admin only server-side; staff without access type it in).
  useEffect(() => {
    const q = customerQuery.trim();
    if (q.length < 2) {
      setCustomerResults([]);
      return;
    }
    const timer = setTimeout(() => {
      listCustomers({ search: q, pageSize: 8 })
        .then((res) => setCustomerResults(res.data))
        .catch(() => setCustomerResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  // Product search: image, price and the branch's stock.
  useEffect(() => {
    const q = productQuery.trim();
    if (q.length < 1) {
      setProductResults([]);
      return;
    }
    const timer = setTimeout(() => {
      listProductsPage({ page: 1, pageSize: 8, search: q, outletId: outletId || undefined })
        .then((res) => setProductResults(res.data))
        .catch(() => setProductResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [productQuery, outletId]);

  const form = {
    outletId,
    customerName,
    customerPhone,
    customerEmail,
    orderType,
    customerAddress,
    regionId,
    area,
    deliveryDate,
    deliveryTimeSlot,
    receiverOn,
    receiverName,
    receiverPhone,
    receiverMessage,
    discountMode,
    discountCode,
    orderDiscountType,
    orderDiscountValue,
    orderDiscountReason,
    feeOverrideOn,
    feeOverride,
    feeOverrideReason,
    notes,
    customerNote,
    items,
  };
  const payloadKey = JSON.stringify(buildDraftPayload(form));
  const lastPreview = useRef(0);

  // The live bill split, from the backend (debounced). A line still waiting for
  // its reason or name is not sent, so the preview never flickers to an error.
  useEffect(() => {
    if (!outletId) return;
    const incomplete = draftFormProblems({ ...form, customerName: "x", customerPhone: "x" }).length > 0;
    if (incomplete) return;
    const ticket = ++lastPreview.current;
    const timer = setTimeout(() => {
      previewDraftOrder(JSON.parse(payloadKey) as DraftOrderInput)
        .then((b) => {
          if (ticket !== lastPreview.current) return;
          setBill(b);
          setBillError(null);
        })
        .catch((err) => {
          if (ticket !== lastPreview.current) return;
          setBillError(err instanceof Error ? err.message : "Could not price this order");
        });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  const regions = regionsRes?.regions ?? [];
  const regionLabel = regionsRes?.country?.regionLabel ?? "Region";
  const currency = bill?.currency ?? draft?.currency ?? "AED";

  function addProduct(product: Product) {
    let variantId: number | undefined;
    let name = product.name;
    if (product.hasVariants) {
      const variant = product.variants.find((v) => v.id === Number(pickedVariant[product.id]));
      if (!variant) {
        toast("Select an option for this product", "error");
        return;
      }
      variantId = variant.id;
      name = `${product.name} · ${variant.label ?? ""}`;
    }
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        custom: false,
        productId: product.id,
        variantId,
        name,
        thumbnail: product.thumbnail,
        quantity: 1,
        price: null,
        priceReason: "",
        taxable: true,
      },
    ]);
    setProductQuery("");
    setProductResults([]);
  }

  function addCustomItem() {
    setItems((prev) => [
      ...prev,
      { key: nextKey(), custom: true, name: "", quantity: 1, price: "", priceReason: "", taxable: true },
    ]);
  }

  function updateItem(key: string, patch: Partial<WorkingItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  const billLineFor = useMemo(() => {
    const map = new Map<string, DraftBill["lines"][number]>();
    if (bill && bill.lines.length === items.length) items.forEach((it, i) => map.set(it.key, bill.lines[i]));
    return map;
  }, [bill, items]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = draftFormProblems(form);
    setProblems(found);
    if (found.length) {
      toast(found[0], "error");
      return;
    }
    setSaving(true);
    try {
      const payload = buildDraftPayload(form);
      if (isEdit) {
        await updateDraftOrder(draft.id, { ...payload, items: payload.items ?? [] });
        toast(draft.payLink ? "Saved. The payment link now charges the new amount." : "Draft saved");
        router.push(`/orders/draft-orders/${draft.id}`);
      } else {
        const created = await createDraftOrder(payload);
        toast("Draft saved");
        router.push(`/orders/draft-orders/${created.id}`);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save the draft", "error");
    } finally {
      setSaving(false);
    }
  }

  const summary = (
    <Card className="space-y-3" data-testid="bill-split">
      <h3 className="text-sm font-semibold">Bill</h3>
      {items.length === 0 ? (
        <p className="text-xs text-text-faint">Add items to see the bill</p>
      ) : !bill ? (
        <p className="text-xs text-text-faint">Pricing…</p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {bill.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2 text-sm">
                <span className="text-text-secondary dark:text-zinc-300 truncate">
                  {l.quantity} × {l.name}
                  {l.variantLabel ? ` · ${l.variantLabel}` : ""}
                </span>
                <span className="shrink-0">
                  <Money amount={l.lineTotal} currency={currency} />
                </span>
              </li>
            ))}
          </ul>
          <dl className="border-t border-black/5 dark:border-white/10 pt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">Subtotal</dt>
              <dd>
                <Money amount={bill.subtotal} currency={currency} />
              </dd>
            </div>
            {Number(bill.discount.amount) > 0 && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <dt>Discount{bill.discount.code ? ` (${bill.discount.code})` : ""}</dt>
                <dd>
                  -<Money amount={bill.discount.amount} currency={currency} />
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-text-muted">{orderType === "pickup" ? "Pickup" : "Delivery"}</dt>
              <dd>
                {bill.deliveryFee === null ? (
                  <span className="text-text-faint">Not priced yet</span>
                ) : Number(bill.deliveryFee) === 0 ? (
                  "Free"
                ) : (
                  <Money amount={bill.deliveryFee} currency={currency} />
                )}
              </dd>
            </div>
            {bill.taxAmount !== null && (
              <div className="flex justify-between">
                <dt className="text-text-muted">{bill.taxInclusive ? "Includes tax" : "Tax"}</dt>
                <dd>
                  <Money amount={bill.taxAmount} currency={currency} />
                </dd>
              </div>
            )}
            <div className="flex justify-between font-semibold pt-1">
              <dt>Total</dt>
              <dd>{bill.total === null ? "" : <Money amount={bill.total} currency={currency} />}</dd>
            </div>
          </dl>
          {bill.deliveryError && <p className="text-xs text-amber-700 dark:text-amber-400">{bill.deliveryError}</p>}
          {bill.stockWarnings.map((w) => (
            <p key={`${w.productId}:${w.variantId ?? ""}`} className="text-xs text-amber-700 dark:text-amber-400" role="status">
              {w.name}: {w.requested} requested, {w.available} in stock at this branch. Nothing is reserved until the order is placed.
            </p>
          ))}
        </>
      )}
      {billError && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {billError}
        </p>
      )}
    </Card>
  );

  return (
    <PageShell as="form" onSubmit={handleSubmit} variant="split" aside={summary}>
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <ul className="list-disc ps-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Customer</h3>
        <div className="relative">
          <Input
            label="Find a customer (name or phone)"
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder="Search existing customers"
          />
          {customerResults.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg dark:border-white/15 dark:bg-zinc-900">
              {customerResults.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-start text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    onClick={() => {
                      setCustomerName(c.name);
                      setCustomerPhone(c.phone);
                      setCustomerEmail(c.email ?? "");
                      setCustomerQuery("");
                      setCustomerResults([]);
                    }}
                  >
                    <span className="font-medium">{c.name}</span> <span className="text-text-muted">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input label="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <Input label="Phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          <Input label="Email (optional)" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Toggle checked={receiverOn} onChange={setReceiverOn} label="Receiver is someone else" />
          <span className="text-sm">Receiver is someone else</span>
        </div>
        {receiverOn && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Receiver name" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
            <Input label="Receiver phone" value={receiverPhone} onChange={(e) => setReceiverPhone(e.target.value)} />
          </div>
        )}
        <Textarea label="Gift message (optional)" value={receiverMessage} onChange={(e) => setReceiverMessage(e.target.value)} rows={2} />
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Fulfilment</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Combobox
            label="Branch"
            value={String(outletId)}
            onChange={(v) => setOutletId(Number(v))}
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-text-secondary dark:text-zinc-400">Order type</p>
            <SegmentedToggle
              value={orderType}
              onChange={setOrderType}
              options={[
                { value: "delivery", label: "Delivery" },
                { value: "pickup", label: "Pickup" },
              ]}
            />
          </div>
        </div>
        {orderType === "delivery" && (
          <>
            <Input label="Delivery address" value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {regions.length > 0 && (
                <Combobox
                  label={regionLabel}
                  value={regionId === null ? "" : String(regionId)}
                  onChange={(v) => setRegionId(v === "" ? null : Number(v))}
                  options={regions.map((r) => ({ value: String(r.id), label: r.nameEn }))}
                />
              )}
              <Input label="Area (optional)" value={area} onChange={(e) => setArea(e.target.value)} />
            </div>
          </>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={orderType === "pickup" ? "Pickup date (optional)" : "Delivery date (optional)"}
            type="date"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
          <Input
            label="Time slot (optional)"
            placeholder="e.g. 14:00-16:00"
            value={deliveryTimeSlot}
            onChange={(e) => setDeliveryTimeSlot(e.target.value)}
          />
        </div>
        {orderType === "delivery" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Toggle checked={feeOverrideOn} onChange={setFeeOverrideOn} label="Change the delivery fee" />
              <span className="text-sm">
                Change the delivery fee
                {!feeOverrideOn && bill?.deliveryZone ? ` (zone: ${bill.deliveryZone})` : ""}
              </span>
            </div>
            {feeOverrideOn && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Delivery fee" type="number" min="0" step="0.01" value={feeOverride} onChange={(e) => setFeeOverride(e.target.value)} />
                <Input label="Reason" value={feeOverrideReason} onChange={(e) => setFeeOverrideReason(e.target.value)} />
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Items</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addCustomItem}>
            <Plus className="size-3.5" />
            Custom item
          </Button>
        </div>
        <div className="relative">
          <Input
            label="Add a product"
            placeholder="Search by name or SKU"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
          />
          <Search className="pointer-events-none absolute end-3 top-9 size-4 text-text-faint" />
          {productResults.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg dark:border-white/15 dark:bg-zinc-900">
              {productResults.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {p.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail} alt="" className="size-9 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="size-9 shrink-0 rounded bg-black/5 dark:bg-white/10" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-text-muted">
                      <Money amount={p.price} currency={currency} />
                      {p.stockQuantity != null && ` · ${p.stockQuantity} in stock`}
                    </span>
                  </span>
                  {p.hasVariants && (
                    <select
                      aria-label={`Option for ${p.name}`}
                      className="h-8 rounded border border-border px-1 text-xs dark:border-white/15 dark:bg-zinc-900"
                      value={pickedVariant[p.id] ?? ""}
                      onChange={(e) => setPickedVariant((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    >
                      <option value="">Option</option>
                      {p.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <Button type="button" size="sm" variant="secondary" onClick={() => addProduct(p)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {items.map((item, index) => {
              const line = billLineFor.get(item.key);
              return (
                <li key={item.key} className="space-y-2 py-3" data-testid={`line-${index}`}>
                  <div className="flex items-center gap-3">
                    {item.custom ? (
                      <Input
                        label="Custom item name"
                        wrapperClassName="flex-1"
                        value={item.name}
                        onChange={(e) => updateItem(item.key, { name: e.target.value })}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                    )}
                    <Input
                      label="Qty"
                      wrapperClassName="w-20"
                      type="number"
                      min="1"
                      value={String(item.quantity)}
                      onChange={(e) => updateItem(item.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((it) => it.key !== item.key))}
                      aria-label={`Remove ${item.name || "custom item"}`}
                      className="mt-5 p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 cursor-pointer"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  {item.custom ? (
                    <div className="flex flex-wrap items-end gap-4">
                      <Input
                        label="Price"
                        wrapperClassName="w-32"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price ?? ""}
                        onChange={(e) => updateItem(item.key, { price: e.target.value })}
                      />
                      <div className="flex items-center gap-2 pb-2">
                        <Toggle
                          checked={item.taxable}
                          onChange={(v) => updateItem(item.key, { taxable: v })}
                          label={`Taxable: ${item.name || "custom item"}`}
                        />
                        <span className="text-sm">Taxable</span>
                      </div>
                      <span className="pb-2 text-xs text-text-faint">Not tracked in inventory</span>
                    </div>
                  ) : item.price === null ? (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-text-muted">
                        {line ? <Money amount={line.unitPrice} currency={currency} /> : "…"} each
                      </span>
                      <button
                        type="button"
                        className="text-xs text-accent-text hover:underline cursor-pointer"
                        onClick={() => updateItem(item.key, { price: line?.unitPrice ?? "0" })}
                      >
                        Change price
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-end gap-4">
                      <Input
                        label="Price"
                        wrapperClassName="w-32"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price}
                        onChange={(e) => updateItem(item.key, { price: e.target.value })}
                      />
                      <Input
                        label="Reason for the changed price"
                        wrapperClassName="flex-1 min-w-48"
                        value={item.priceReason}
                        onChange={(e) => updateItem(item.key, { priceReason: e.target.value })}
                        error={!item.priceReason.trim() ? "A reason is required" : undefined}
                      />
                      <button
                        type="button"
                        className="pb-2 text-xs text-text-muted hover:underline cursor-pointer"
                        onClick={() => updateItem(item.key, { price: null, priceReason: "" })}
                      >
                        Use the catalogue price
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="space-y-4">
        <h3 className="text-sm font-semibold">Discount</h3>
        <SegmentedToggle
          value={discountMode}
          onChange={setDiscountMode}
          options={[
            { value: "none", label: "None" },
            { value: "code", label: "Discount code" },
            { value: "manual", label: "Manual discount" },
          ]}
        />
        {discountMode === "code" && (
          <Input label="Discount code" value={discountCode} onChange={(e) => setDiscountCode(e.target.value.toUpperCase())} />
        )}
        {discountMode === "manual" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Combobox
              label="Type"
              value={orderDiscountType}
              onChange={(v) => setOrderDiscountType(v as "percent" | "fixed")}
              options={[
                { value: "percent", label: "Percent" },
                { value: "fixed", label: "Fixed amount" },
              ]}
            />
            <Input
              label={orderDiscountType === "percent" ? "Percent" : "Amount"}
              type="number"
              min="0"
              step="0.01"
              value={orderDiscountValue}
              onChange={(e) => setOrderDiscountValue(e.target.value)}
            />
            <Input label="Reason" value={orderDiscountReason} onChange={(e) => setOrderDiscountReason(e.target.value)} />
          </div>
        )}
      </Card>

      <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Textarea label="Internal note (staff only)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        <Textarea
          label="Note for the customer (optional)"
          value={customerNote}
          onChange={(e) => setCustomerNote(e.target.value)}
          rows={3}
        />
      </Card>

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/orders/draft-orders")}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          Save draft
        </Button>
      </div>
    </PageShell>
  );
}
