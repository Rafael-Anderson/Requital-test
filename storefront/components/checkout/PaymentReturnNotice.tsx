"use client";

import { useSyncExternalStore } from "react";
import { hasCheckoutAttempt } from "@/lib/checkout-attempt";

const subscribe = () => () => {};

// The payment gateway's cancel link returns the shopper to /checkout?orderId=<n>
// with their cart intact. If this tab really did just submit a checkout (it holds
// that attempt's key), say what happened and what to do: the order is saved, so
// submitting the same details again goes back to payment for that same order
// instead of placing a second one (the server answers the same key with the same
// order). Without the key (another tab or browser) there is nothing to claim, so
// nothing is shown. Read through useSyncExternalStore: it needs the URL and
// sessionStorage, which the server render cannot see.
export default function PaymentReturnNotice({ shopSlug }: { shopSlug: string }) {
  const show = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).has("orderId") && hasCheckoutAttempt(shopSlug),
    () => false,
  );
  if (!show) return null;
  return (
    <p role="status" className="theme-round-md border border-stroke p-3 mb-4 text-sm">
      Your payment was not completed. Your order is saved, so you will not be charged twice or placed twice. Review your
      details and continue to payment below.
    </p>
  );
}
