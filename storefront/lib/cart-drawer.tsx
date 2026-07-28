"use client";

import { createContext, useContext, useState } from "react";

interface CartDrawerContextValue {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const CartDrawerContext = createContext<CartDrawerContextValue | null>(null);

// Only meaningfully used when theme.cartLayout === "drawer" — the header
// cart icon and CartDrawer both need to agree on open/closed state, and
// they're siblings under ShopLayoutClient rather than parent/child, so a
// small context is simpler than prop-threading through Body/Header.
export function CartDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <CartDrawerContext.Provider value={{ open, openDrawer: () => setOpen(true), closeDrawer: () => setOpen(false) }}>
      {children}
    </CartDrawerContext.Provider>
  );
}

export function useCartDrawer() {
  const ctx = useContext(CartDrawerContext);
  if (!ctx) throw new Error("useCartDrawer must be used within CartDrawerProvider");
  return ctx;
}
