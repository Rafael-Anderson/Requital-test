"use client";

import { useState } from "react";
import { Shuffle } from "lucide-react";
import { createDiscount, updateDiscount } from "@/lib/api";
import {
  DISCOUNT_APPLIES_TO,
  DISCOUNT_APPLIES_TO_LABELS,
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_LABELS,
  type Collection,
  type Discount,
  type DiscountAppliesTo,
  type DiscountType,
  type Product,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Product/collection eligibility uses a plain multi-select — same "no
// searchable picker exists in this app" reasoning as Bio Links' single-select
// product/collection pickers, just with the `multiple` attribute since a
// discount can target more than one.
export default function DiscountFormModal({
  discount,
  products,
  collections,
  onClose,
  onSaved,
}: {
  discount: Discount | null;
  products: Product[];
  collections: Collection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [requiresCode, setRequiresCode] = useState(discount ? discount.discountType !== "auto" : true);
  const [code, setCode] = useState(discount?.code ?? "");
  const [type, setType] = useState<DiscountType>(discount?.type ?? "PERCENTAGE");
  const [value, setValue] = useState(discount?.value ?? "");
  const [minPurchaseAmount, setMinPurchaseAmount] = useState(discount?.minPurchaseAmount ?? "");
  const [appliesTo, setAppliesTo] = useState<DiscountAppliesTo>(discount?.appliesTo ?? "ALL_PRODUCTS");
  const [productIds, setProductIds] = useState<Set<number>>(new Set(discount?.products.map((p) => p.id) ?? []));
  const [collectionIds, setCollectionIds] = useState<Set<number>>(new Set(discount?.collections.map((c) => c.id) ?? []));
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

  // An auto-apply discount can't be scoped to ALL_PRODUCTS — it needs a
  // concrete product/collection set to know when to kick in with no code
  // entered. Switching the toggle off nudges appliesTo to a valid choice
  // instead of leaving it on an option this mode doesn't allow.
  function handleRequiresCodeChange(next: boolean) {
    setRequiresCode(next);
    if (!next && appliesTo === "ALL_PRODUCTS") setAppliesTo("SPECIFIC_PRODUCTS");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requiresCode && !code.trim()) return;
    if (type !== "FREE_SHIPPING" && !value) {
      toast("Value is required for this discount type", "error");
      return;
    }
    if (!requiresCode && appliesTo === "SPECIFIC_PRODUCTS" && productIds.size === 0) {
      toast("Pick at least one product for this auto discount", "error");
      return;
    }
    if (!requiresCode && appliesTo === "SPECIFIC_COLLECTIONS" && collectionIds.size === 0) {
      toast("Pick at least one collection for this auto discount", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: requiresCode ? code.trim() : undefined,
        discountType: requiresCode ? ("code" as const) : ("auto" as const),
        type,
        value: type === "FREE_SHIPPING" ? undefined : Number(value),
        minPurchaseAmount: minPurchaseAmount ? Number(minPurchaseAmount) : undefined,
        appliesTo,
        productIds: appliesTo === "SPECIFIC_PRODUCTS" ? [...productIds] : undefined,
        collectionIds: appliesTo === "SPECIFIC_COLLECTIONS" ? [...collectionIds] : undefined,
        usageLimit: usageLimit ? Number(usageLimit) : undefined,
        usageLimitPerCustomer: usageLimitPerCustomer ? Number(usageLimitPerCustomer) : undefined,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        active,
      };
      const label = requiresCode ? code.trim() : "Auto discount";
      if (discount) {
        await updateDiscount(discount.id, payload);
        toast(`"${label}" updated`);
      } else {
        await createDiscount(payload);
        toast(`"${label}" created`);
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
    <Modal onClose={onClose} size="sm" title={discount ? `Edit "${discount.code ?? "Auto discount"}"` : "New discount"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          <div className="flex items-center gap-2">
            <Toggle checked={requiresCode} onChange={handleRequiresCodeChange} />
            <span className="text-sm">Requires code</span>
          </div>

          {requiresCode ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
              </div>
              <Button type="button" variant="secondary" onClick={() => setCode(randomCode())} title="Generate random code">
                <Shuffle className="size-4" />
              </Button>
            </div>
          ) : (
            <p className="text-xs text-text-faint">
              Applies automatically to every matching cart, no code needed. Pick the products or collections it
              applies to below.
            </p>
          )}

          <Select label="Type" value={type} onChange={(e) => setType(e.target.value as DiscountType)}>
            {DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DISCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>

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

          <Select
            label="Applies to"
            value={appliesTo}
            onChange={(e) => setAppliesTo(e.target.value as DiscountAppliesTo)}
          >
            {DISCOUNT_APPLIES_TO
              // An auto discount always needs a concrete product/collection
              // target to know when to apply itself with no code entered.
              .filter((a) => requiresCode || a !== "ALL_PRODUCTS")
              .map((a) => (
                <option key={a} value={a}>
                  {DISCOUNT_APPLIES_TO_LABELS[a]}
                </option>
              ))}
          </Select>

          {appliesTo === "SPECIFIC_PRODUCTS" && (
            <Select
              label="Products (ctrl/cmd-click to select multiple)"
              multiple
              value={[...productIds].map(String)}
              onChange={(e) => setProductIds(new Set(selectedOptions(e)))}
              className="h-32"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}

          {appliesTo === "SPECIFIC_COLLECTIONS" && (
            <Select
              label="Collections (ctrl/cmd-click to select multiple)"
              multiple
              value={[...collectionIds].map(String)}
              onChange={(e) => setCollectionIds(new Set(selectedOptions(e)))}
              className="h-32"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
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

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {discount ? "Save changes" : "Create discount"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
