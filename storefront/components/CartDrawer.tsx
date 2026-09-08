"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { useCartDrawer } from "@/lib/cart-drawer";
import { storeButtonClassName } from "@/lib/button-style";
import { useAnimatedNumber } from "@/lib/use-animated-number";
import CurrencySymbol from "@/components/CurrencySymbol";
import { iconStyleProps } from "@/lib/icon-style";
import CartLineItems from "@/components/CartLineItems";

// §8.13.C item 13 — drawers.animation open transitions. `slide` (and absent)
// is today's exact treatment; the others swap which classes carry the
// closed/open state. transitionDuration comes from --motion-duration-base as
// before (so the blanket reduced-motion rule still zeroes it).
const DRAWER_MOTION: Record<string, { transition: string; closed: string; open: string }> = {
  slide: { transition: "transition-transform", closed: "translate-x-full", open: "translate-x-0" },
  "slide-fade": {
    transition: "transition-[transform,opacity]",
    closed: "translate-x-full opacity-0",
    open: "translate-x-0 opacity-100",
  },
  scale: {
    transition: "origin-right transition-[transform,opacity]",
    closed: "scale-95 opacity-0 pointer-events-none",
    open: "scale-100 opacity-100",
  },
  none: { transition: "", closed: "translate-x-full", open: "translate-x-0" },
};

// The "drawer" cart layout preset — same items/subtotal/checkout affordance
// as the full-page cart, in an overlay instead of a navigation. Only
// mounted at all when theme.cartLayout === "drawer" (see ShopLayoutClient).
export default function CartDrawer() {
  const { shop, shopBasePath, themeConfig } = useShop();
  const { items, subtotal } = useCart();
  const { open, closeDrawer } = useCartDrawer();

  const subtotalAnim = themeConfig?.globalSettings.cart?.subtotalAnimation;
  const countedSubtotal = useAnimatedNumber(subtotal, subtotalAnim === "count");
  const shownSubtotal = subtotalAnim === "count" ? countedSubtotal : subtotal;

  const drawers = themeConfig?.globalSettings.drawers;
  const motion = DRAWER_MOTION[drawers?.animation ?? "slide"] ?? DRAWER_MOTION.slide;
  // §8.18 follow-up — bordersStyle 'none' (default) + dropShadow true
  // (default) reproduce today's panel exactly; 'solid' adds a 1px drawer-
  // scheme border, dropShadow false drops the shadow.
  const drawerChrome = `${drawers?.bordersStyle === "solid" ? "border border-drawer-border" : ""} ${
    drawers?.dropShadow === false ? "" : "shadow-2xl"
  }`;

  return (
    // A single fixed, viewport-sized, overflow-clipped shell holds both the
    // backdrop and the panel. The closed panel sits at translate-x-full
    // (off-screen right) — as a bare `fixed` element its in-flow content used
    // to extend document.scrollWidth by the panel width, giving every page a
    // phantom horizontal scrollbar on a `cartLayout: drawer` shop. Clipping
    // it here (the shell is exactly the viewport, pointer-events-none so it
    // never blocks the page) removes that without touching the open layout.
    <div className="fixed inset-0 z-50 overflow-hidden pointer-events-none">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={closeDrawer}
        aria-hidden={!open}
      />
      <div
        className={`absolute top-0 right-0 h-full w-full max-w-sm bg-drawer text-drawer-fg ${drawerChrome} flex flex-col ${open ? "pointer-events-auto " : ""}${motion.transition} ${
          open ? motion.open : motion.closed
        }`}
        style={{ transitionDuration: "var(--motion-duration-base, 300ms)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Cart"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stroke shrink-0">
          <h2 className="font-semibold">Your cart</h2>
          <button type="button" onClick={closeDrawer} aria-label="Close cart" className="flex items-center justify-center size-8 rounded-full hover:bg-mouse-over/10 cursor-pointer">
            <X className="size-4" {...iconStyleProps(shop?.iconStyle, 1.75)} />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-zinc-500">Your cart is empty.</p>
            <button type="button" onClick={closeDrawer} className="text-sm text-accent hover:underline cursor-pointer">
              Continue shopping
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              <CartLineItems />
            </div>
            <div className="border-t border-stroke px-4 py-4 space-y-3 shrink-0">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Subtotal</span>
                <span
                  key={subtotalAnim === "flash" ? Math.round(subtotal * 100) : undefined}
                  className={`font-medium${subtotalAnim === "flash" ? " theme-cart-subtotal-flash" : ""}`}
                >
                  {shownSubtotal.toFixed(2)} <CurrencySymbol code={shop?.currency} />
                </span>
              </div>
              <Link
                href={`${shopBasePath}/checkout`}
                onClick={closeDrawer}
                className={`block w-full text-center h-11 leading-[44px] font-medium ${storeButtonClassName(shop)}`}
              >
                Proceed to checkout
              </Link>
              <Link href={`${shopBasePath}/cart`} onClick={closeDrawer} className="block w-full text-center text-sm text-zinc-500 hover:text-accent">
                View full cart
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
