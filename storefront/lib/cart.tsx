"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface CartItem {
  productId: number;
  // Set only for a variant-bearing product — two different variants of the
  // same product are distinct cart lines (see addItemToState's match key).
  variantId?: number;
  variantLabel?: string;
  name: string;
  price: number;
  thumbnail: string;
  quantity: number;
  maxStock: number | null; // null = unlimited (not stock-tracked)
  // Gift Cards — when true, `price` IS the denomination/custom amount the
  // shopper picked (not a catalog price), and checkout sends it back as
  // this line's giftCardAmount rather than leaving it off the payload — see
  // useCheckoutForm.ts's items mapping.
  isGiftCard?: boolean;
}

export interface CartState {
  outletId: number | null;
  items: CartItem[];
  // Applied promo code, carried from cart to checkout the same way items
  // are (persisted in the same localStorage blob) — the actual discount
  // amount is never trusted client-side; checkout re-validates and the
  // server atomically claims it at order-creation time.
  discountCode: string | null;
  // Same persistence/trust shape as discountCode — the remaining balance
  // shown at checkout is only ever the result of the most recent live
  // GiftCardsService.validateCode call, never trusted from here, and the
  // actual draw-down happens server-side inside the order transaction.
  giftCardCode: string | null;
}

interface CartContextValue {
  outletId: number | null;
  items: CartItem[];
  discountCode: string | null;
  giftCardCode: string | null;
  subtotal: number;
  count: number;
  // Adding from a different outlet than the cart currently holds clears it
  // first — stock/price context doesn't carry over between outlets.
  addItem: (item: Omit<CartItem, "quantity">, quantity: number, outletId: number) => void;
  setQuantity: (productId: number, quantity: number, variantId?: number) => void;
  removeItem: (productId: number, variantId?: number) => void;
  setDiscountCode: (code: string | null) => void;
  setGiftCardCode: (code: string | null) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function storageKey(shopSlug: string) {
  return `requital_storefront_cart:${shopSlug}`;
}

// Two different variants of the same product are distinct cart lines — this
// is the match key used everywhere an item needs to be found/updated.
// undefined variantId (a non-variant product) matches only itself, same as
// before this field existed.
function sameLine(item: { productId: number; variantId?: number }, productId: number, variantId?: number): boolean {
  return item.productId === productId && item.variantId === variantId;
}

// Pure state transitions, extracted so the add/remove/quantity-clamping
// logic (the actual bug-prone part) is testable without rendering React —
// same rationale as lib/color-contrast.ts staying a plain function.
export function addItemToState(
  state: CartState,
  item: Omit<CartItem, "quantity">,
  quantity: number,
  outletId: number,
): CartState {
  // Adding from a different outlet than the cart currently holds clears it
  // first — stock/price context doesn't carry over between outlets.
  const items = state.outletId !== null && state.outletId !== outletId ? [] : state.items;
  const existing = items.find((i) => sameLine(i, item.productId, item.variantId));
  const cap = item.maxStock ?? Infinity;
  if (existing) {
    // A gift card product has no variants to key a second, independently-
    // priced line off — re-adding it at a *different* chosen amount
    // replaces the line's price/quantity rather than merging quantities at
    // the original (now stale) amount, which would silently keep charging
    // whichever amount was picked first. Same amount re-added still just
    // increments quantity, same as any other product.
    if (item.isGiftCard && existing.price !== item.price) {
      return {
        ...state,
        outletId,
        items: items.map((i) =>
          sameLine(i, item.productId, item.variantId) ? { ...i, ...item, quantity: Math.min(quantity, cap) } : i,
        ),
      };
    }
    const nextQty = Math.min(existing.quantity + quantity, cap);
    return {
      ...state,
      outletId,
      items: items.map((i) => (sameLine(i, item.productId, item.variantId) ? { ...i, quantity: nextQty } : i)),
    };
  }
  return { ...state, outletId, items: [...items, { ...item, quantity: Math.min(quantity, cap) }] };
}

export function setQuantityInState(
  state: CartState,
  productId: number,
  quantity: number,
  variantId?: number,
): CartState {
  return {
    ...state,
    items:
      quantity <= 0
        ? state.items.filter((i) => !sameLine(i, productId, variantId))
        : state.items.map((i) =>
            sameLine(i, productId, variantId) ? { ...i, quantity: Math.min(quantity, i.maxStock ?? Infinity) } : i,
          ),
  };
}

export function removeItemFromState(state: CartState, productId: number, variantId?: number): CartState {
  return { ...state, items: state.items.filter((i) => !sameLine(i, productId, variantId)) };
}

export function CartProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const [state, setState] = useState<CartState>({ outletId: null, items: [], discountCode: null, giftCardCode: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(shopSlug));
      if (raw) {
        const parsed = JSON.parse(raw) as CartState;
        // A cart saved before discountCode/giftCardCode existed parses
        // without those keys — default them rather than carrying an
        // undefined field through state.
        setState({ ...parsed, discountCode: parsed.discountCode ?? null, giftCardCode: parsed.giftCardCode ?? null });
      }
    } catch {
      // corrupt/blocked storage — start with an empty cart rather than crash
    }
    setLoaded(true);
  }, [shopSlug]);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(storageKey(shopSlug), JSON.stringify(state));
  }, [shopSlug, state, loaded]);

  const addItem = useCallback<CartContextValue["addItem"]>((item, quantity, outletId) => {
    setState((prev) => addItemToState(prev, item, quantity, outletId));
  }, []);

  const setQuantity = useCallback((productId: number, quantity: number, variantId?: number) => {
    setState((prev) => setQuantityInState(prev, productId, quantity, variantId));
  }, []);

  const removeItem = useCallback((productId: number, variantId?: number) => {
    setState((prev) => removeItemFromState(prev, productId, variantId));
  }, []);

  const setDiscountCode = useCallback((code: string | null) => {
    setState((prev) => ({ ...prev, discountCode: code }));
  }, []);

  const setGiftCardCode = useCallback((code: string | null) => {
    setState((prev) => ({ ...prev, giftCardCode: code }));
  }, []);

  const clear = useCallback(
    () => setState({ outletId: null, items: [], discountCode: null, giftCardCode: null }),
    [],
  );

  const subtotal = useMemo(
    () => state.items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [state.items],
  );
  const count = useMemo(() => state.items.reduce((sum, i) => sum + i.quantity, 0), [state.items]);

  return (
    <CartContext.Provider
      value={{
        outletId: state.outletId,
        items: state.items,
        discountCode: state.discountCode,
        giftCardCode: state.giftCardCode,
        subtotal,
        count,
        addItem,
        setQuantity,
        removeItem,
        setDiscountCode,
        setGiftCardCode,
        clear,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
