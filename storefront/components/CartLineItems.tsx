"use client";

import { useShop } from "@/lib/shop-context";
import { lineAllowance, useCart } from "@/lib/cart";
import CurrencySymbol from "@/components/CurrencySymbol";
import { formatPriceAmount } from "@/lib/currency";

// The actual line-item list + qty controls, shared verbatim between the
// full-page cart (app/[shop]/cart/page.tsx) and the slide-out CartDrawer —
// same theme.cartLayout preset system as checkout, same rule: one real
// implementation of the item list, not two copies that can drift.
export default function CartLineItems() {
  const { shop, themeConfig } = useShop();
  const { items, setQuantity, removeItem } = useCart();

  // §8.13.C item 13 — cart.itemAnimation. Each row carries a mount-triggered
  // one-shot fade (`.theme-cart-item-in`, plays once with no `forwards`), so a
  // newly-added row animates in on its own mount. Rows that don't remount
  // (quantity bumps) never replay it. Setting off ⇒ no class, byte-identical
  // markup. The blanket reduced-motion rule neutralises it.
  const animateItems = themeConfig?.globalSettings.cart?.itemAnimation === true;

  // How much more each line can hold: stock, plus the order size limits
  // (lib/cart.tsx), which depend on the rest of the cart.
  const allowances = items.map((i) => lineAllowance(items, i));

  return (
    <div className="divide-y divide-black/5">
      {items.map((item, idx) => (
        <div
          key={`${item.productId}:${item.variantId ?? ""}`}
          className={`flex items-center gap-3 py-4${animateItems ? " theme-cart-item-in" : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnail} alt={item.name} className="size-14 rounded-lg object-cover bg-black/5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm text-product-name">{item.name}</p>
            {item.variantLabel && <p className="text-xs text-zinc-500">{item.variantLabel}</p>}
            {item.maxStock !== null && item.quantity >= item.maxStock && (
              <p className="text-xs text-zinc-500">Only {item.maxStock} available</p>
            )}
            {allowances[idx].message && item.quantity >= allowances[idx].orderMax && (
              <p className="text-xs text-zinc-500">{allowances[idx].message}</p>
            )}
            <p className="text-sm text-price-main">
              {formatPriceAmount(item.price, shop?.currency)} <CurrencySymbol code={shop?.currency} />
            </p>
          </div>
          <div className="flex items-center border border-stroke rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setQuantity(item.productId, item.quantity - 1, item.variantId)}
              aria-label={`Decrease quantity of ${item.name}`}
              className="min-h-9 min-w-9 cursor-pointer"
            >
              −
            </button>
            <span className="px-1.5 min-w-6 text-center text-sm">{item.quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(item.productId, item.quantity + 1, item.variantId)}
              disabled={item.quantity >= allowances[idx].max}
              aria-label={`Increase quantity of ${item.name}`}
              className="min-h-9 min-w-9 cursor-pointer disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => removeItem(item.productId, item.variantId)}
            aria-label={`Remove ${item.name} from cart`}
            className="text-xs text-zinc-400 hover:text-red-600 cursor-pointer shrink-0">
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
