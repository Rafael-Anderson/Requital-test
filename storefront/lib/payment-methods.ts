import type { PaymentMethod, Shop } from "./types";

// Pure (no React) so the delivery/pickup payment-method resolution — real
// branching logic, not just a flat list — is directly testable. Used by
// checkout/page.tsx to build both the delivery and pickup method lists.
export function resolvePaymentMethods(
  shop: Pick<
    Shop,
    | "deliveryPaymentCardOnline"
    | "deliveryPaymentCashOnDelivery"
    | "deliveryPaymentCardOnDelivery"
    | "pickupPaymentCardOnline"
    | "pickupPaymentCashOnPickup"
    | "pickupPaymentCardOnPickup"
    | "cardProcessorEnabled"
    | "enabledPaymentProviders"
  > | null,
  context: "delivery" | "pickup",
): PaymentMethod[] {
  const independent = (shop?.enabledPaymentProviders ?? []) as PaymentMethod[];
  if (context === "delivery") {
    return [
      // cardProcessorEnabled: the boolean flag alone isn't enough — the
      // shop's active card processor (Nomod/Stripe) must also actually be
      // enabled, or this would offer an option that 400s at checkout.
      ...(shop?.deliveryPaymentCardOnline && shop?.cardProcessorEnabled ? (["card_online"] as const) : []),
      ...(shop?.deliveryPaymentCashOnDelivery ? (["cash_on_delivery"] as const) : []),
      ...(shop?.deliveryPaymentCardOnDelivery ? (["card_on_delivery"] as const) : []),
      ...independent,
    ];
  }
  return [
    ...(shop?.pickupPaymentCardOnline && shop?.cardProcessorEnabled ? (["card_online"] as const) : []),
    ...(shop?.pickupPaymentCashOnPickup ? (["cash_on_pickup"] as const) : []),
    ...(shop?.pickupPaymentCardOnPickup ? (["card_on_pickup"] as const) : []),
    ...independent,
  ];
}
