"use client";

import { useState } from "react";
import { X, Shuffle } from "lucide-react";
import { createDiscount, updateDiscount } from "@/lib/api";
import {
  DISCOUNT_APPLIES_TO,
  DISCOUNT_APPLIES_TO_LABELS,
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_LABELS,
  type Category,
  type Discount,
  type DiscountAppliesTo,
  type DiscountType,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Product/category eligibility uses a plain multi-select — same "no
// searchable picker exists in this app" reasoning as Bio Links' single-select
// product/category pickers, just with the `multiple` attribute since a
// discount can target more than one.
export default function DiscountFormModal({
  discount,
  products,
  categories,
  onClose,
  onSaved,
}: {
  discount: Discount | null;
  products: Product[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(discount?.code ?? "");
  const [type, setType] = useState<DiscountType>(discount?.type ?? "PERCENTAGE");
  const [value, setValue] = useState(discount?.value ?? "");
  const [minPurchaseAmount, setMinPurchaseAmount] = useState(discount?.minPurchaseAmount ?? "");
  const [appliesTo, setAppliesTo] = useState<DiscountAppliesTo>(discount?.appliesTo ?? "ALL_PRODUCTS");
  const [productIds, setProductIds] = useState<Set<number>>(new Set(discount?.products.map((p) => p.id) ?? []));
  const [categoryIds, setCategoryIds] = useState<Set<number>>(new Set(discount?.categories.map((c) => c.id) ?? []));
  const [usageLimit, setUsageLimit] = useState(discount?.usageLimit != null ? String(discount.usageLimit) : "");
  const [usageLimitPerCustomer, setUsageLimitPerCustomer] = useState(
    discount?.usageLimitPerCustomer != null ? String(discount.usageLimitPerCustomer) : "",
  );
  const [startsAt, setStartsAt] = useState(discount?.startsAt?.slice(0, 10) ?? "");
  const [endsAt, setEndsAt] = useState(discount?.endsAt?.slice(0, 10) ?? "");
  const [active, setActive] = useState(discount?.active ?? true);
  const [saving, setSaving] = useState(false);

  function selectedOptions(e: React.ChangeEvent<HTMLSelectElement>): number[] {
    return Array.from(e.target.selectedOptions).map((o) => Number(o.value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    if (type !== "FREE_SHIPPING" && !value) {
      toast("Value is required for this discount type", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        type,
        value: type === "FREE_SHIPPING" ? undefined : Number(value),
        minPurchaseAmount: minPurchaseAmount ? Number(minPurchaseAmount) : undefined,
        appliesTo,
        productIds: appliesTo === "SPECIFIC_PRODUCTS" ? [...productIds] : undefined,
        categoryIds: appliesTo === "SPECIFIC_CATEGORIES" ? [...categoryIds] : undefined,
        usageLimit: usageLimit ? Number(usageLimit) : undefined,
        usageLimitPerCustomer: usageLimitPerCustomer ? Number(usageLimitPerCustomer) : undefined,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        active,
      };
      if (discount) {
        await updateDiscount(discount.id, payload);
        toast(`"${code}" updated`);
      } else {
        await createDiscount(payload);
        toast(`"${code}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save discount", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative max-h-[90vh] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-4">{discount ? `Edit "${discount.code}"` : "New discount"}</h2>

        <div className="space-y-3.5">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
            </div>
            <Button type="button" variant="secondary" onClick={() => setCode(randomCode())} title="Generate random code">
              <Shuffle className="size-4" />
            </Button>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as DiscountType)} className={SELECT_CLASS}>
              {DISCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DISCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {type !== "FREE_SHIPPING" && (
            <Input
              label={type === "PERCENTAGE" ? "Value (%)" : "Value (AED)"}
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          )}

          <Input
            label="Minimum purchase amount (optional)"
            type="number"
            min="0"
            step="0.01"
            value={minPurchaseAmount}
            onChange={(e) => setMinPurchaseAmount(e.target.value)}
          />

          <div>
            <label className="text-sm font-medium block mb-1">Applies to</label>
            <select
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as DiscountAppliesTo)}
              className={SELECT_CLASS}
            >
              {DISCOUNT_APPLIES_TO.map((a) => (
                <option key={a} value={a}>
                  {DISCOUNT_APPLIES_TO_LABELS[a]}
                </option>
              ))}
            </select>
          </div>

          {appliesTo === "SPECIFIC_PRODUCTS" && (
            <div>
              <label className="text-sm font-medium block mb-1">Products (ctrl/cmd-click to select multiple)</label>
              <select
                multiple
                value={[...productIds].map(String)}
                onChange={(e) => setProductIds(new Set(selectedOptions(e)))}
                className={`${SELECT_CLASS} h-32`}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {appliesTo === "SPECIFIC_CATEGORIES" && (
            <div>
              <label className="text-sm font-medium block mb-1">Categories (ctrl/cmd-click to select multiple)</label>
              <select
                multiple
                value={[...categoryIds].map(String)}
                onChange={(e) => setCategoryIds(new Set(selectedOptions(e)))}
                className={`${SELECT_CLASS} h-32`}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Usage limit (optional)"
              type="number"
              min="1"
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
              placeholder="Unlimited"
            />
            <Input
              label="Per-customer limit (optional)"
              type="number"
              min="1"
              value={usageLimitPerCustomer}
              onChange={(e) => setUsageLimitPerCustomer(e.target.value)}
              placeholder="Unlimited"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Starts (optional)" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <Input label="Ends (optional)" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>

          <div className="flex items-center gap-2">
            <Toggle checked={active} onChange={setActive} />
            <span className="text-sm">Active</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {discount ? "Save changes" : "Create discount"}
          </Button>
        </div>
      </form>
    </div>
  );
}
