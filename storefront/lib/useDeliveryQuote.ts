"use client";

import { useCallback, useEffect, useState } from "react";
import { quoteDelivery, type DeliveryQuote, type DeliveryQuoteRequest } from "@/lib/api";
import type { CartItem } from "@/lib/cart";

// What the checkout needs to ask the server for a delivery quote, or null while
// there is nothing to ask yet (no outlet, or a delivery address with no region,
// pin or area): the UI then says the fee is calculated after the address, it
// never shows 0 or a guess.
export function buildQuoteRequest(p: {
  items: CartItem[];
  outletId: number | null;
  orderType: "delivery" | "pickup" | null;
  regionId: number | null;
  area: string;
  coords: { latitude: number; longitude: number } | null;
  discountCode: string | null | undefined;
  // Google Maps is unavailable to this shopper (F9): the typed address stands in
  // for a pin, so the server stops demanding one.
  addressManual?: boolean;
}): DeliveryQuoteRequest | null {
  if (!p.outletId || !p.orderType || p.items.length === 0) return null;
  const delivery = p.orderType === "delivery";
  if (delivery && p.regionId == null && !p.coords && !p.area.trim()) return null;
  return {
    outletId: p.outletId,
    orderType: p.orderType,
    regionId: delivery ? (p.regionId ?? undefined) : undefined,
    area: delivery ? p.area.trim() || undefined : undefined,
    latitude: delivery ? p.coords?.latitude : undefined,
    longitude: delivery ? p.coords?.longitude : undefined,
    addressManual: delivery && p.addressManual && !p.coords ? true : undefined,
    discountCode: p.discountCode || undefined,
    items: p.items.map((i) => ({
      productId: i.productId,
      variantId: i.variantId,
      quantity: i.quantity,
      giftCardAmount: i.isGiftCard ? i.price : undefined,
    })),
  };
}

export type DeliveryQuoteState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; quote: DeliveryQuote }
  | { phase: "error"; message: string };

const DEBOUNCE_MS = 350;

// Debounced, cancel-on-change quote for the current request. "Loading" is
// derived (the latest result belongs to a different request key), so a stale
// answer can never be shown against newer inputs, and no state is set
// synchronously inside the effect.
export function useDeliveryQuote(shopSlug: string, request: DeliveryQuoteRequest | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; quote?: DeliveryQuote; error?: string } | null>(null);
  const key = request ? `${attempt}:${JSON.stringify(request)}` : null;

  useEffect(() => {
    if (!request || !key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      quoteDelivery(shopSlug, request, controller.signal)
        .then((quote) => setResult({ key, quote }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResult({ key, error: err instanceof Error ? err.message : "Could not calculate delivery" });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `request` is captured by value through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopSlug, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let state: DeliveryQuoteState = { phase: "idle" };
  if (key) {
    if (result?.key !== key) state = { phase: "loading" };
    else if (result.quote) state = { phase: "ready", quote: result.quote };
    else state = { phase: "error", message: result.error ?? "Could not calculate delivery" };
  }
  return { state, retry };
}

// A quote the customer must not order past: the server said this cart cannot be
// delivered as asked, said which location detail it still needs, or is still
// working out the figure the page is about to show as the total.
export function quoteBlocksSubmit(state: DeliveryQuoteState): boolean {
  if (state.phase === "loading") return true;
  if (state.phase !== "ready") return false;
  const { status, reason } = state.quote;
  return status === "unavailable" || (status === "needs_address" && !!reason);
}
