"use client";

import { useShop } from "@/lib/shop-context";

// Wraps a gated route's children (see lib/not-found-gate.ts). While the shop is
// loading, ShopLayoutClient renders the route's server layer so a notFound()
// thrown there is seen by the server render, but the client page beneath must
// not run (no shop yet, and no duplicate fetches), so it only mounts once the
// shop has loaded.
export default function RenderWhenShopLoaded({ children }: { children: React.ReactNode }) {
  const { loading } = useShop();
  return loading ? null : <>{children}</>;
}
