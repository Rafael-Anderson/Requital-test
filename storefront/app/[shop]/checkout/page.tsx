"use client";

import { useState } from "react";
import { useCheckoutForm } from "@/lib/useCheckoutForm";
import { useCart } from "@/lib/cart";
import CheckoutLayout from "@/components/checkout/CheckoutLayout";
import AddonPrompt from "@/components/checkout/AddonPrompt";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import EmptyCartState from "@/components/EmptyCartState";
import PaymentReturnNotice from "@/components/checkout/PaymentReturnNotice";

// One page, two columns (components/checkout/CheckoutLayout.tsx). The older
// step-by-step layout and the Checkout layout theme setting are gone; a theme that
// still stores `checkoutLayout` is simply ignored here. All state, validation and
// submission live in useCheckoutForm.
export default function CheckoutPage() {
  const state = useCheckoutForm();
  const { outletId: cartOutletId } = useCart();
  const [addonDone, setAddonDone] = useState(false);

  if (state.items.length === 0) {
    return (
      <StorefrontPageShell variant="wide">
        <EmptyCartState />
      </StorefrontPageShell>
    );
  }
  // contact_to_order shops never really "check out" via cart — the popup's
  // upsell is meaningless there (see ProductDetailClient's cartMode gate).
  // Nor is it worth showing when nothing can be ordered (fulfilment "none"):
  // the shopper goes straight to the explanation.
  const addonPromptEligible =
    state.fulfilment.mode !== "none" && !(state.shop?.disableStoreCart && state.shop.cartDisabledMode === "contact_to_order");

  if (addonPromptEligible && !addonDone) {
    return (
      <StorefrontPageShell variant="medium">
        <AddonPrompt
          shopSlug={state.shopSlug}
          outletId={cartOutletId}
          excludeProductIds={state.items.map((i) => i.productId)}
          onDone={() => setAddonDone(true)}
        />
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="wide">
      <PaymentReturnNotice shopSlug={state.shopSlug} />
      <CheckoutLayout {...state} />
    </StorefrontPageShell>
  );
}
