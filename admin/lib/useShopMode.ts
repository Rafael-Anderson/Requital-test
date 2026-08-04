"use client";

import { useEffect, useState } from "react";
import { getShop } from "./api";

// Same getShop() effect ProductForm/useProductForm.ts uses to read
// shop.productEditorMode — shared here since Orders/Customers/Dashboard all
// need the identical fetch. Re-fetched fresh on every mount (not a shared
// context), so a mode change saved in Settings shows up the moment a client
// navigation remounts one of these pages — no reload, no cross-tab sync needed.
export function useShopMode(): "simple" | "advanced" | null {
  const [mode, setMode] = useState<"simple" | "advanced" | null>(null);

  useEffect(() => {
    getShop()
      .then((s) => setMode(s.productEditorMode ?? "simple"))
      .catch(() => setMode("simple"));
  }, []);

  return mode;
}
