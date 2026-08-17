"use client";

import { useEffect, useState } from "react";
import { createOrderReturn, getOrderReturns } from "@/lib/api";
import type { Order, OrderReturn } from "@/lib/types";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Combobox from "@/components/ui/Combobox";
import { useToast } from "@/components/ui/Toast";

const RETURN_REASONS: { value: OrderReturn["reason"]; label: string }[] = [
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong item" },
  { value: "changed_mind", label: "Customer changed mind" },
  { value: "other", label: "Other" },
];

export default function OrderReturnsSection({
  order,
  onChanged,
}: {
  order: Order;
  onChanged?: () => void;
}) {
  const [returns, setReturns] = useState<OrderReturn[] | null>(null);
  const [initiating, setInitiating] = useState(false);
  const [selected, setSelected] = useState<Record<number, number>>({}); // orderItemId -> qty
  const [reason, setReason] = useState<OrderReturn["reason"]>("damaged");
  const [restock, setRestock] = useState(true);
  const [refundAmount, setRefundAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    getOrderReturns(order.id)
      .then(setReturns)
      .catch(() => setReturns([]));
  }, [order.id]);

  if (order.status !== "delivered" && !returns?.length) return null;

  const alreadyReturnedByItem = new Map<number, number>();
  for (const r of returns ?? []) {
    for (const ri of r.orderreturnitem) {
      alreadyReturnedByItem.set(ri.orderItemId, (alreadyReturnedByItem.get(ri.orderItemId) ?? 0) + ri.quantity);
    }
  }
  const returnableItems = order.orderitem
    .map((item) => ({ item, remaining: item.quantity - (alreadyReturnedByItem.get(item.id) ?? 0) }))
    .filter((x) => x.remaining > 0);

  const computedRefund = returnableItems.reduce((sum, { item }) => {
    const qty = selected[item.id] ?? 0;
    return sum + qty * Number(item.priceAtPurchase);
  }, 0);

  function toggleItem(itemId: number, remaining: number, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[itemId] = remaining;
      else delete next[itemId];
      return next;
    });
    setAmountTouched(false);
  }

  function setQty(itemId: number, qty: number, remaining: number) {
    const clamped = Math.max(1, Math.min(qty, remaining));
    setSelected((prev) => ({ ...prev, [itemId]: clamped }));
    setAmountTouched(false);
  }

  async function handleSubmit() {
    const items = Object.entries(selected)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId: Number(orderItemId), quantity }));
    if (items.length === 0) {
      toast("Select at least one item to return", "error");
      return;
    }
    setSaving(true);
    try {
      await createOrderReturn(order.id, {
        items,
        reason,
        restock,
        refundAmount: amountTouched ? Number(refundAmount) : undefined,
      });
      toast("Return processed");
      setInitiating(false);
      setSelected({});
      setAmountTouched(false);
      getOrderReturns(order.id).then(setReturns);
      onChanged?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to process return", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-border rounded-lg p-4 dark:border-white/10">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Returns / refunds</h3>
        {order.status === "delivered" && !initiating && returnableItems.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setInitiating(true)}>
            Process return
          </Button>
        )}
      </div>

      {returns === null ? (
        <p className="text-sm text-text-faint">Loading…</p>
      ) : returns.length > 0 ? (
        <div className="space-y-2 mb-3">
          {returns.map((r) => (
            <div key={r.id} className="text-sm border border-border rounded-md p-2.5 dark:border-white/10">
              <div className="flex justify-between">
                <span className="font-medium">{r.refundAmount} AED refunded</span>
                <span className="text-xs text-text-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="text-xs text-text-muted mt-0.5 capitalize">
                {r.reason.replace(/_/g, " ")} · {r.refundMethod === "provider" ? "refunded via gateway" : "manual refund"} ·{" "}
                {r.restocked ? "restocked" : "not restocked"} · by {r.staff.name}
              </div>
            </div>
          ))}
        </div>
      ) : (
        !initiating && <p className="text-sm text-text-faint">No returns yet.</p>
      )}

      {initiating && (
        <div className="space-y-3 border-t border-gray-200 dark:border-white/10 pt-3 mt-1">
          <div className="space-y-2">
            {returnableItems.map(({ item, remaining }) => {
              const checked = item.id in selected;
              return (
                <div key={item.id} className="flex items-center gap-3">
                  <Checkbox
                    checked={checked}
                    onChange={(e) => toggleItem(item.id, remaining, e.target.checked)}
                  />
                  <div className="flex-1 min-w-0 text-sm">
                    {item.productName}
                    {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    <span className="text-text-faint"> ({remaining} eligible)</span>
                  </div>
                  {checked && (
                    <input
                      type="number"
                      min={1}
                      max={remaining}
                      value={selected[item.id]}
                      onChange={(e) => setQty(item.id, Number(e.target.value), remaining)}
                      className="h-7 w-16 rounded-md border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-2 text-sm text-right outline-none focus:border-accent"
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted shrink-0">Reason</span>
              <div className="w-44">
                <Combobox
                  value={reason}
                  onChange={(value) => setReason(value as OrderReturn["reason"])}
                  options={RETURN_REASONS}
                />
              </div>
            </div>
            <Checkbox
              label="Restock returned items"
              checked={restock}
              onChange={(e) => setRestock(e.target.checked)}
            />
          </div>

          <label className="text-sm text-text-muted flex items-center gap-2">
            Refund amount
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountTouched ? refundAmount : computedRefund.toFixed(2)}
              onChange={(e) => {
                setAmountTouched(true);
                setRefundAmount(e.target.value);
              }}
              className="h-8 w-28 rounded-md border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-2 text-sm text-right outline-none focus:border-accent"
            />
            AED
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setInitiating(false); setSelected({}); setAmountTouched(false); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSubmit} disabled={saving}>
              {saving ? "Processing…" : "Confirm return"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
