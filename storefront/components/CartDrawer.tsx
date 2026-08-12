"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { useCartDrawer } from "@/lib/cart-drawer";
import { storeButtonClassName } from "@/lib/button-style";
import { iconStyleProps } from "@/lib/icon-style";
import CartLineItems from "@/components/CartLineItems";

// The "drawer" cart layout preset — same items/subtotal/checkout affordance
// as the full-page cart, in an overlay instead of a navigation. Only
// mounted at all when theme.cartLayout === "drawer" (see ShopLayoutClient).
export default function CartDrawer() {
  const { shop } = useShop();
  const { items, subtotal } = useCart();
  const { open, closeDrawer } = useCartDrawer();

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/40 transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={closeDrawer}
        aria-hidden={!open}
      />
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-sm bg-header text-header-fg shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
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
                <span className="font-medium">
                  {subtotal.toFixed(2)} {shop?.currency}
                </span>
              </div>
              <Link
                href="/checkout"
                onClick={closeDrawer}
                className={`block w-full text-center h-11 leading-[44px] font-medium ${storeButtonClassName(shop)}`}
              >
                Proceed to checkout
              </Link>
              <Link href="/cart" onClick={closeDrawer} className="block w-full text-center text-sm text-zinc-500 hover:text-accent">
                View full cart
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
