"use client";

import { useEffect, useState } from "react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { currencySymbol } from "@/lib/currency";
import { listProducts } from "@/lib/api";
import { storeButtonClassName } from "@/lib/button-style";
import type { Product } from "@/lib/types";

// Shown once per checkout attempt, before the real checkout layout renders,
// when the cart doesn't already contain every isCheckoutAddon-flagged
// product the shop has. Purely a convenience upsell — skip/dismiss always
// proceeds to checkout unchanged. See checkout/page.tsx for the gating
// (cartDisabledMode/contact_to_order, "only once" state).
export default function AddonPrompt({
  shopSlug,
  outletId,
  excludeProductIds,
  onDone,
}: {
  shopSlug: string;
  outletId: number | null;
  excludeProductIds: number[];
  onDone: () => void;
}) {
  const { shop } = useShop();
  const { addItem } = useCart();
  const [addons, setAddons] = useState<Product[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listProducts(shopSlug, outletId ?? undefined, undefined, true)
      .then((products) => {
        if (cancelled) return;
        const eligible = products.filter((p) => !excludeProductIds.includes(p.id));
        if (eligible.length === 0) {
          onDone();
          return;
        }
        setAddons(eligible);
      })
      .catch(() => onDone());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!addons) return null;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleContinue() {
    if (!addons || outletId === null) {
      onDone();
      return;
    }
    for (const product of addons) {
      if (!selected.has(product.id)) continue;
      addItem(
        {
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          thumbnail: product.thumbnail,
          maxStock: product.stockQuantity,
        },
        1,
        outletId,
      );
    }
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onDone}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg bg-header text-header-fg p-6"
      >
        <h2 className="text-lg font-semibold">Would you like to add any extras?</h2>
        <div className="mt-4 divide-y divide-black/5">
          {addons!.map((product) => (
            <label key={product.id} className="flex items-center gap-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(product.id)}
                onChange={() => toggle(product.id)}
                className="size-4 shrink-0"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.thumbnail} alt={product.name} className="size-12 rounded-lg object-cover bg-black/5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{product.name}</p>
                <p className="text-sm text-zinc-500">
                  {product.price} {currencySymbol(shop?.currency)}
                </p>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={onDone} className="text-sm text-zinc-500 hover:underline cursor-pointer">
            Skip
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className={`flex-1 h-11 font-medium ${storeButtonClassName(shop)}`}
          >
            Continue to checkout
          </button>
        </div>
      </div>
    </div>
  );
}
