"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useShop } from "@/lib/shop-context";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// §8.13.C item 16 — fly-to-cart. A cloned product image arcs from the
// add-to-cart source (a quick-add card or the PDP gallery) to the header
// cart icon, then fades. Purely decorative: the caller has already run
// `addItem(...)` before calling `flyToCart`, so the cart count updates
// immediately regardless of this animation (or the cap below).
//
// Provider pattern mirrors lib/cart-drawer.tsx — a tiny context mounted in
// ShopLayoutClient, consumed by siblings (QuickAddButton, ProductDetailClient).
// The cart-icon destination is a DOM marker (`data-fly-to-cart-target`), the
// same cross-tree approach as `data-theme-hero` — no threaded refs.

const CLONE_ATTR = "data-fly-to-cart-clone";
const TARGET_SELECTOR = "[data-fly-to-cart-target]";
const FALLBACK_DURATION_MS = 600; // 'standard' intensity's --motion-duration-slow (lib/motion.ts).

// Rapid-click spam guard, NOT an arbitrary number: a shopper who
// double/triple-clicks quick-add (same product or several in quick
// succession) would otherwise flood `document.body` with detached <img>
// nodes, each animating for ~600ms. Five lets a genuine burst of a few
// adds all animate; a 6th concurrent call skips ONLY the visual clone —
// `addItem` has already run at the call site, so cart correctness is never
// affected by the cap.
const MAX_LIVE_CLONES = 5;

interface FlyToCartContextValue {
  flyToCart: (sourceEl: HTMLElement | null) => void;
}

const FlyToCartContext = createContext<FlyToCartContextValue | null>(null);

function readMotion(prop: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  return v || fallback;
}

// The visible cart icon — desktop TopBar and the mobile bar can both be in
// the DOM; take the first that's actually rendered (offsetParent is null for
// a `display:none` ancestor).
function resolveTarget(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(TARGET_SELECTOR));
  return all.find((el) => el.offsetParent !== null) ?? all[0] ?? null;
}

export function FlyToCartProvider({ children }: { children: React.ReactNode }) {
  const { themeConfig } = useShop();
  const reducedMotion = useReducedMotion();
  const liveClones = useRef(0);

  const animations = themeConfig?.globalSettings.animations;
  const enabled = animations?.addToCart === true && animations?.addToCartStyle === "fly";

  const flyToCart = useCallback(
    (sourceEl: HTMLElement | null) => {
      if (!enabled || reducedMotion || !sourceEl) return;
      if (liveClones.current >= MAX_LIVE_CLONES) return; // spam guard — see MAX_LIVE_CLONES
      const target = resolveTarget();
      if (!target) return;

      const src = sourceEl.getBoundingClientRect();
      const dst = target.getBoundingClientRect();
      if (src.width === 0 || src.height === 0) return;

      const imgSrc =
        sourceEl.querySelector<HTMLImageElement>("img")?.currentSrc ||
        (sourceEl as HTMLImageElement).currentSrc ||
        "";
      if (!imgSrc) return;

      const clone = document.createElement("img");
      clone.setAttribute(CLONE_ATTR, "");
      clone.src = imgSrc;
      clone.alt = "";
      Object.assign(clone.style, {
        position: "fixed",
        left: `${src.left}px`,
        top: `${src.top}px`,
        width: `${src.width}px`,
        height: `${src.height}px`,
        objectFit: "cover",
        borderRadius: "var(--theme-radius, 8px)",
        zIndex: "2147483000",
        pointerEvents: "none",
        willChange: "transform, opacity",
        margin: "0",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(clone);
      liveClones.current += 1;

      const dx = dst.left + dst.width / 2 - (src.left + src.width / 2);
      const dy = dst.top + dst.height / 2 - (src.top + src.height / 2);
      const duration = parseFloat(readMotion("--motion-duration-slow", `${FALLBACK_DURATION_MS}`)) || FALLBACK_DURATION_MS;
      const easing = readMotion("--motion-ease", "cubic-bezier(0.4, 0, 0.2, 1)");

      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        liveClones.current = Math.max(0, liveClones.current - 1);
        clone.remove();
      };

      const anim = clone.animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 0.9, offset: 0 },
          // a slight upward lift at the midpoint fakes an arc without a real path
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(0.6)`, opacity: 0.9, offset: 0.6 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0, offset: 1 },
        ],
        { duration, easing, fill: "forwards" },
      );
      anim.onfinish = cleanup;
      // Safety net: a backgrounded tab can starve `onfinish` (same lesson as
      // use-scroll-value.ts's rAF/timeout race).
      window.setTimeout(cleanup, duration + 250);
    },
    [enabled, reducedMotion],
  );

  // SPA-leak guard: clones live on document.body, not in this subtree, so a
  // shop switch (provider unmount) mid-flight could otherwise orphan one.
  useEffect(() => {
    return () => {
      document.querySelectorAll(`[${CLONE_ATTR}]`).forEach((el) => el.remove());
    };
  }, []);

  return <FlyToCartContext.Provider value={{ flyToCart }}>{children}</FlyToCartContext.Provider>;
}

// Tolerant of a missing provider (returns an inert no-op) — QuickAddButton /
// PDP render in trees a test might not wrap, same convention as useWishlist.
export function useFlyToCart(): FlyToCartContextValue {
  return useContext(FlyToCartContext) ?? { flyToCart: () => {} };
}
