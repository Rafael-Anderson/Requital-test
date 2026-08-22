"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { validateDiscount } from "@/lib/api";

// Shared by cart and checkout — the applied code itself lives in cart state
// (see lib/cart.tsx), persisted the same way items are; the discount
// *amount* is never trusted client-side or persisted, only ever the result
// of the most recent live validate() call, re-run on mount so navigating
// cart -> checkout re-confirms an already-applied code is still good.
export default function PromoCodeField({
  shopSlug,
  productIds,
  onAmountChange,
}: {
  shopSlug: string;
  productIds: number[];
  onAmountChange?: (amount: number | null, freeShipping: boolean) => void;
}) {
  const { discountCode, setDiscountCode, subtotal } = useCart();
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!discountCode) {
      onAmountChange?.(null, false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    validateDiscount(shopSlug, { code: discountCode, cartSubtotal: subtotal, productIds })
      .then((res) => {
        if (cancelled) return;
        if (res.valid) {
          setError(null);
          onAmountChange?.(res.discountAmount ?? 0, !!res.freeShipping);
        } else {
          // The code was applied earlier but no longer qualifies (e.g. cart
          // changed under the minimum, or it expired/was exhausted since) —
          // drop it rather than silently keep showing a stale amount.
          setError(res.message ?? "This code no longer applies");
          setDiscountCode(null);
          onAmountChange?.(null, false);
        }
      })
      .catch(() => {
        if (!cancelled) onAmountChange?.(null, false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountCode, subtotal, shopSlug]);

  async function apply() {
    const code = input.trim().toUpperCase();
    if (!code) return;
    setChecking(true);
    setError(null);
    try {
      const res = await validateDiscount(shopSlug, { code, cartSubtotal: subtotal, productIds });
      if (res.valid) {
        setDiscountCode(code);
        setInput("");
        onAmountChange?.(res.discountAmount ?? 0, !!res.freeShipping);
      } else {
        setError(res.message ?? "This code cannot be applied");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this code");
    } finally {
      setChecking(false);
    }
  }

  function remove() {
    setDiscountCode(null);
    setError(null);
    onAmountChange?.(null, false);
  }

  if (discountCode) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-stroke px-3 py-2 text-sm">
        <span>
          Promo code <strong>{discountCode}</strong> {checking ? "checking…" : "applied"}
        </span>
        <button type="button" onClick={remove} className="text-zinc-400 hover:text-red-600 cursor-pointer">
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="Promo code"
          className="flex-1 h-9 rounded-lg border border-stroke bg-background px-3 text-sm outline-none focus:border-accent transition-colors"
        />
        <button
          type="button"
          onClick={apply}
          disabled={checking || !input.trim()}
          className="h-9 px-3 rounded-lg border border-stroke text-sm cursor-pointer disabled:opacity-50 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          {checking ? "Checking…" : "Apply"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
