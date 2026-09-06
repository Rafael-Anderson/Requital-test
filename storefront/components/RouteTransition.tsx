"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useShop } from "@/lib/shop-context";

// §8.13.C item 17 — route-content fade. When `animations.pageTransition` is
// on, a keyed wrapper around the route content replays a short fade + 8px
// rise on every pathname change (search-param-only changes don't count —
// `usePathname` excludes them, which is what we want: a sort/filter change
// shouldn't full-fade the page). Off / absent — the `DEFAULT_THEME_CONFIG`
// value, and every template's — ⇒ the children render with no wrapper at
// all, byte-identical to today. The blanket `prefers-reduced-motion` rule
// neutralises the keyframe (content still appears).
//
// View Transitions (`document.startViewTransition`) is deliberately NOT
// layered on here — Chromium-only, and Next's App Router support for it is
// still moving. The plain keyed fade is the real feature (plan doc §8.20
// flag #2).
export default function RouteTransition({ children }: { children: ReactNode }) {
  const { themeConfig } = useShop();
  const pathname = usePathname();

  if (themeConfig?.globalSettings.animations.pageTransition !== true) {
    return <>{children}</>;
  }
  return (
    <div key={pathname} className="theme-route-transition">
      {children}
    </div>
  );
}
