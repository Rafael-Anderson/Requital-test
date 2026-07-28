"use client";

import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";

// The actual line-item list + qty controls, shared verbatim between the
// full-page cart (app/[shop]/cart/page.tsx) and the slide-out CartDrawer —
// same theme.cartLayout preset system as checkout, same rule: one real
// implementation of the item list, not two copies that can drift.
export default function CartLineItems() {
  const { shop } = useShop();
  const { items, setQuantity, removeItem } = useCart();

  return (
    <div className="divide-y divide-black/5">
      {items.map((item) => (
        <div key={`${item.productId}:${item.variantId ?? ""}`} className="flex items-center gap-3 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnail} alt={item.name} className="size-14 rounded-lg object-cover bg-black/5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm text-product-name">{item.name}</p>
            {item.variantLabel && <p className="text-xs text-zinc-500">{item.variantLabel}</p>}
            <p className="text-sm text-price-main">
              {item.price} {shop?.currency}
            </p>
          </div>
          <div className="flex items-center border border-stroke rounded-lg shrink-0">
            <button type="button" onClick={() => setQuantity(item.productId, item.quantity - 1, item.variantId)} className="px-2 py-1 cursor-pointer">
              −
            </button>
            <span className="px-1.5 min-w-6 text-center text-sm">{item.quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(item.productId, item.quantity + 1, item.variantId)}
              disabled={item.maxStock !== null && item.quantity >= item.maxStock}
              className="px-2 py-1 cursor-pointer disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button type="button" onClick={() => removeItem(item.productId, item.variantId)} className="text-xs text-zinc-400 hover:text-red-600 cursor-pointer shrink-0">
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
