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
  // Nomod sends the shopper back with ?payment=failed or ?payment=cancelled. It is only
  // wording: whether the order was paid is the server's word, never this URL's.
  const reason = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get("payment"),
    () => null,
  );
  if (!show) return null;
  const lead =
    reason === "failed"
      ? "Your payment did not go through."
      : reason === "cancelled"
        ? "You cancelled the payment."
        : "Your payment was not completed.";
  return (
    <p role="status" className="theme-round-md border border-stroke p-3 mb-4 text-sm">
      {lead} Your order is saved, so you will not be charged twice or placed twice. Review your details and continue to
      payment below.
    </p>
  );
}
