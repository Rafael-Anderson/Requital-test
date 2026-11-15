"use client";

import CurrencySymbol from "@/components/CurrencySymbol";
import { formatPriceAmount } from "@/lib/currency";
import type { CartItem } from "@/lib/cart";

// The cart's lines inside the checkout summary: thumbnail, name, variant,
// quantity and the line price. Display only (quantities are changed in the cart);
// the server prices the order, and the totals below are the server's quote.
export default function CheckoutOrderItems({ items, currency }: { items: CartItem[]; currency?: string }) {
  return (
    <ul className="divide-y divide-black/5" data-testid="checkout-items">
      {items.map((item) => (
        <li key={`${item.productId}:${item.variantId ?? ""}`} className="flex items-center gap-3 py-3 first:pt-0">
          <span className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumbnail} alt="" className="size-14 rounded-lg object-cover bg-black/5" />
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -end-1.5 min-w-5 h-5 px-1 rounded-full bg-accent text-accent-foreground text-[11px] font-medium flex items-center justify-center"
            >
              {item.quantity}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate text-product-name">{item.name}</p>
            {item.variantLabel && <p className="text-xs text-zinc-500 truncate">{item.variantLabel}</p>}
            <p className="text-xs text-zinc-500">
              {item.quantity} × {formatPriceAmount(item.price, currency)} <CurrencySymbol code={currency} />
            </p>
          </div>
          <p className="text-sm font-medium shrink-0 whitespace-nowrap">
            {formatPriceAmount(item.price * item.quantity, currency)} <CurrencySymbol code={currency} />
          </p>
        </li>
      ))}
    </ul>
  );
}
