"use client";

import { useState } from "react";
import Link from "next/link";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { quoteCartTax } from "@/lib/order-tax";
import PromoCodeField from "@/components/PromoCodeField";
import CartLineItems from "@/components/CartLineItems";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import EmptyCartState from "@/components/EmptyCartState";
import { storeButtonClassName } from "@/lib/button-style";
import CurrencySymbol from "@/components/CurrencySymbol";
import { formatPriceAmount } from "@/lib/currency";

// Always reachable by direct navigation regardless of theme.cartLayout —
// the "drawer" preset changes what clicking the header cart icon does, not
// whether this page exists (a merchant can still link to /cart directly,
// and this is where the drawer's own "View full cart" goes).
export default function CartPage() {
  const { shopSlug, shopBasePath, shop } = useShop();
  const { items, subtotal } = useCart();
  const [discountAmount, setDiscountAmount] = useState<number | null>(null);
  const total = Math.max(0, subtotal - (discountAmount ?? 0));
  const taxQuote = quoteCartTax({
    lines: items.map((i) => ({ amount: i.price * i.quantity, taxRate: i.taxRate })),
    discountAmount: discountAmount ?? 0,
    taxInclusive: Boolean(shop?.taxInclusive),
    fallbackRate: Number(shop?.taxRate ?? 0),
  });

  if (items.length === 0) {
    return (
      <StorefrontPageShell variant="wide">
        <EmptyCartState />
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
            {formatPriceAmount(subtotal, shop?.currency)} <CurrencySymbol code={shop?.currency} />
          </span>
        </div>
        {discountAmount !== null && discountAmount > 0 && (
          <div className="flex items-center justify-between text-green-600">
            <span>Discount</span>
            <span>
              -{formatPriceAmount(discountAmount, shop?.currency)} <CurrencySymbol code={shop?.currency} />
            </span>
          </div>
        )}
        {/* Per-line tax, the same mirror the checkout shows (lib/order-tax.ts).
            Delivery is still only known once an address is entered, so the cart
            total remains goods + tax. */}
        {!taxQuote.empty && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">
              {shop?.taxInclusive ? "Includes tax" : "Tax"}
              {taxQuote.estimated ? " (estimated)" : ""}
            </span>
            <span>
              {formatPriceAmount(taxQuote.taxAmount, shop?.currency)} <CurrencySymbol code={shop?.currency} />
            </span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <span className="text-zinc-600">Total</span>
          <span className="text-lg font-semibold">
            {formatPriceAmount(shop?.taxInclusive ? total : total + taxQuote.taxAmount, shop?.currency)} <CurrencySymbol code={shop?.currency} />
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
