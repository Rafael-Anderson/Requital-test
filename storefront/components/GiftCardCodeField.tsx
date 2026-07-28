"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { validateGiftCard } from "@/lib/api";

// Mirrors PromoCodeField exactly — same "code lives in cart state, amount
// is never trusted client-side, re-validated on mount" shape. A gift card
// and a discount code can both be applied to the same order (see
// PublicService.createOrder: discount reduces the taxable subtotal, gift
// card is a payment credit against the final total) — this field is
// independent of PromoCodeField, not a replacement for it.
export default function GiftCardCodeField({
  shopSlug,
  onAmountChange,
}: {
  shopSlug: string;
  onAmountChange?: (amount: number | null) => void;
}) {
  const { giftCardCode, setGiftCardCode } = useCart();
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingBalance, setRemainingBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!giftCardCode) {
      onAmountChange?.(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    validateGiftCard(shopSlug, giftCardCode)
      .then((res) => {
        if (cancelled) return;
        if (res.valid) {
          setError(null);
          setRemainingBalance(res.remainingBalance ?? null);
          onAmountChange?.(res.remainingBalance ?? 0);
        } else {
          setError(res.message ?? "This gift card no longer applies");
          setGiftCardCode(null);
          onAmountChange?.(null);
        }
      })
      .catch(() => {
        if (!cancelled) onAmountChange?.(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftCardCode, shopSlug]);

  async function apply() {
    const code = input.trim().toUpperCase();
    if (!code) return;
    setChecking(true);
    setError(null);
    try {
      const res = await validateGiftCard(shopSlug, code);
      if (res.valid) {
        setGiftCardCode(code);
        setInput("");
        setRemainingBalance(res.remainingBalance ?? null);
        onAmountChange?.(res.remainingBalance ?? 0);
      } else {
        setError(res.message ?? "This gift card cannot be applied");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check this gift card");
    } finally {
      setChecking(false);
    }
  }

  function remove() {
    setGiftCardCode(null);
    setError(null);
    setRemainingBalance(null);
    onAmountChange?.(null);
  }

  if (giftCardCode) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-stroke px-3 py-2 text-sm">
        <span>
          Gift card <strong>{giftCardCode}</strong>{" "}
          {checking ? "checking…" : remainingBalance !== null ? `applied (balance ${remainingBalance})` : "applied"}
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
          placeholder="Gift card code"
          className="flex-1 h-9 rounded-lg border border-stroke bg-white dark:bg-zinc-900 px-3 text-sm outline-none focus:border-accent transition-colors"
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
