"use client";

import { useCheckoutForm } from "@/lib/useCheckoutForm";
import CheckoutSinglePage from "@/components/checkout/CheckoutSinglePage";
import CheckoutSteps from "@/components/checkout/CheckoutSteps";
import StorefrontPageShell from "@/components/StorefrontPageShell";

// Dispatches on theme.checkoutLayout — both presets share the exact same
// state/validation/submission logic (useCheckoutForm), so a layout switch
// can never change how an order actually gets placed, only how the fields
// are grouped and paged through. See useCheckoutForm.ts.
export default function CheckoutPage() {
  const state = useCheckoutForm();

  if (state.items.length === 0) {
    return (
      <StorefrontPageShell variant="medium">
        <p className="text-zinc-500">Your cart is empty.</p>
      </StorefrontPageShell>
    );
  }
  if (!state.deliveryAvailable && !state.pickupAvailable) {
    return (
      <StorefrontPageShell variant="medium">
        <p className="text-red-600">Neither delivery nor pickup is currently available for this shop.</p>
      </StorefrontPageShell>
    );
  }

  return (
    <StorefrontPageShell variant="medium">
      {state.shop?.checkoutLayout === "step_by_step" ? <CheckoutSteps {...state} /> : <CheckoutSinglePage {...state} />}
    </StorefrontPageShell>
  );
}
