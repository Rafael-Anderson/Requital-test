"use client";

import { useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import PromoCodeField from "@/components/PromoCodeField";
import CartLineItems from "@/components/CartLineItems";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import { storeButtonClassName } from "@/lib/button-style";
import { currencySymbol } from "@/lib/currency";

// Always reachable by direct navigation regardless of theme.cartLayout —
// the "drawer" preset changes what clicking the header cart icon does, not
// whether this page exists (a merchant can still link to /cart directly,
// and this is where the drawer's own "View full cart" goes).
export default function CartPage() {
  const { shopSlug, shopBasePath, shop } = useShop();
  const { items, subtotal } = useCart();
  const [discountAmount, setDiscountAmount] = useState<number | null>(null);
  const total = Math.max(0, subtotal - (discountAmount ?? 0));

  if (items.length === 0) {
    return (
      <StorefrontPageShell variant="medium">
        <h1 className="text-2xl font-semibold mb-4">Your cart</h1>
        <p className="text-zinc-500">Your cart is empty.</p>
        <Link href={shopBasePath || "/"} className="text-accent hover:underline mt-2 inline-block">
          Continue shopping
        </Link>
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="medium">
      <h1 className="text-2xl font-semibold mb-4">Your cart</h1>
      <CartLineItems />
      <div className="mt-4">
        <PromoCodeField
          shopSlug={shopSlug}
          productIds={items.map((i) => i.productId)}
          onAmountChange={(amount) => setDiscountAmount(amount)}
        />
      </div>

      <div className="mt-4 pt-4 border-t border-stroke space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">Subtotal</span>
          <span>
            {subtotal.toFixed(2)} {currencySymbol(shop?.currency)}
          </span>
        </div>
        {discountAmount !== null && discountAmount > 0 && (
          <div className="flex items-center justify-between text-green-600 dark:text-green-400">
            <span>Discount</span>
            <span>
              -{discountAmount.toFixed(2)} {currencySymbol(shop?.currency)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-zinc-600">Total</span>
          <span className="text-lg font-semibold">
            {total.toFixed(2)} {currencySymbol(shop?.currency)}
          </span>
        </div>
      </div>
      <Link
        href={`${shopBasePath}/checkout`}
        className={`mt-4 block w-full text-center h-11 leading-[44px] font-medium ${storeButtonClassName(shop)}`}
      >
        Proceed to checkout
      </Link>
    </StorefrontPageShell>
  );
}
